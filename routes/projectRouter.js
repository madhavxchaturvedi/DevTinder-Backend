const express = require("express");
const router = express.Router();
const { userAuth } = require("../middlewares/auth");
const Post = require("../models/Post");
const ProjectRequest = require("../models/ProjectRequest");
const ProjectRoom = require("../models/ProjectRoom");
const Notification = require("../models/Notification");
const ConnectionRequestModel = require("../models/connectionRequest");

// GET /feed/projects
router.get("/feed/projects", userAuth, async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    let limit = parseInt(req.query.limit) || 10;
    limit = limit > 50 ? 50 : limit;
    const skip = (page - 1) * limit;

    const { stack, stage } = req.query;

    const query = {
      type: "project",
      moderationStatus: "safe"
    };

    if (stack) {
      query["project.techStack"] = stack.toLowerCase();
    }
    if (stage) {
      query["project.stage"] = stage;
    }

    const posts = await Post.find(query)
      .populate("authorId", "firstName lastName photoUrl skills")
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit);

    // For each project post, check if the current user has already submitted a ProjectRequest
    const postIds = posts.map(p => p._id);
    const existingRequests = await ProjectRequest.find({
      projectPostId: { $in: postIds },
      requesterId: req.user._id
    });

    const existingRequestMap = existingRequests.reduce((acc, req) => {
      acc[req.projectPostId.toString()] = true;
      return acc;
    }, {});

    // Count pending requests per project
    const pendingRequests = await ProjectRequest.aggregate([
      { $match: { projectPostId: { $in: postIds }, status: "pending" } },
      { $group: { _id: "$projectPostId", count: { $sum: 1 } } }
    ]);

    const requestCounts = pendingRequests.reduce((acc, req) => {
      acc[req._id.toString()] = req.count;
      return acc;
    }, {});

    const postsWithRequestStatus = posts.map(p => {
      const postObj = p.toObject();
      postObj.hasRequested = !!existingRequestMap[p._id.toString()];
      return postObj;
    });

    res.json({ data: postsWithRequestStatus, requestCounts });
  } catch (err) {
    res.status(400).json({ message: "Error: " + err.message });
  }
});

// POST /project/request/:postId
router.post("/project/request/:postId", userAuth, async (req, res) => {
  try {
    const { postId } = req.params;
    const { message } = req.body;
    const requesterId = req.user._id;

    const post = await Post.findById(postId);
    if (!post || post.type !== "project") {
      return res.status(404).json({ message: "Project post not found." });
    }

    if (!post.project.isOpen) {
      return res.status(400).json({ message: "Project is no longer open." });
    }

    if (post.authorId.toString() === requesterId.toString()) {
      return res.status(400).json({ message: "You cannot request to join your own project." });
    }

    const existingRequest = await ProjectRequest.findOne({ projectPostId: postId, requesterId });
    if (existingRequest) {
      return res.status(400).json({ message: "You have already sent a request." });
    }

    const projectRequest = await ProjectRequest.create({
      projectPostId: postId,
      requesterId,
      ownerId: post.authorId,
      message,
      status: "pending"
    });

    // Notify owner
    const notification = await Notification.create({
      userId: post.authorId,
      actorIds: [requesterId],
      type: "project_join_request",
      postId: postId,
      projectRequestId: projectRequest._id
    });

    const populatedNotification = await notification.populate("actorIds", "firstName lastName photoUrl");
    const io = req.app.get("io");
    if (io) {
      io.to(`user:${post.authorId}`).emit("newNotification", populatedNotification);
    }

    res.json({ message: "Request sent successfully.", data: projectRequest });
  } catch (err) {
    res.status(400).json({ message: "Error: " + err.message });
  }
});

// GET /project/:postId/requests
router.get("/project/:postId/requests", userAuth, async (req, res) => {
  try {
    const { postId } = req.params;

    const post = await Post.findById(postId);
    if (!post) {
      return res.status(404).json({ message: "Post not found." });
    }

    if (post.authorId.toString() !== req.user._id.toString()) {
      return res.status(403).json({ message: "Only the post author can view requests." });
    }

    const requests = await ProjectRequest.find({ projectPostId: postId })
      .populate("requesterId", "firstName lastName photoUrl skills about")
      .sort({ createdAt: -1 });

    res.json({ data: requests });
  } catch (err) {
    res.status(400).json({ message: "Error: " + err.message });
  }
});

// POST /project/review/:requestId/:status
router.post("/project/review/:requestId/:status", userAuth, async (req, res) => {
  try {
    const { requestId, status } = req.params;
    const ownerId = req.user._id;

    if (!["accepted", "rejected"].includes(status)) {
      return res.status(400).json({ message: "Invalid status." });
    }

    const projectRequest = await ProjectRequest.findById(requestId);
    if (!projectRequest) {
      return res.status(404).json({ message: "Project request not found." });
    }

    if (projectRequest.ownerId.toString() !== ownerId.toString()) {
      return res.status(403).json({ message: "Unauthorized." });
    }

    if (projectRequest.status !== "pending") {
      return res.status(400).json({ message: "Request is already processed." });
    }

    if (status === "accepted") {
      projectRequest.status = "accepted";
      await projectRequest.save();

      // Reject other pending requests
      const otherRequests = await ProjectRequest.find({
        projectPostId: projectRequest.projectPostId,
        _id: { $ne: requestId },
        status: "pending"
      });

      for (const reqObj of otherRequests) {
        reqObj.status = "rejected";
        await reqObj.save();
        
        const notif = await Notification.create({
          userId: reqObj.requesterId,
          actorIds: [ownerId],
          type: "project_rejected",
          postId: projectRequest.projectPostId,
          projectRequestId: reqObj._id
        });
        const popNotif = await notif.populate("actorIds", "firstName lastName photoUrl");
        const io = req.app.get("io");
        if (io) io.to(`user:${reqObj.requesterId}`).emit("newNotification", popNotif);
      }

      const post = await Post.findById(projectRequest.projectPostId);
      if (post) {
        post.project.isOpen = false;
        await post.save();
      }

      // ConnectionRequest logic
      const requesterId = projectRequest.requesterId;
      let connectionReq = await ConnectionRequestModel.findOne({
        $or: [
          { fromUserId: ownerId, toUserId: requesterId },
          { fromUserId: requesterId, toUserId: ownerId }
        ]
      });

      if (!connectionReq) {
        await ConnectionRequestModel.create({
          fromUserId: ownerId,
          toUserId: requesterId,
          status: "accepted"
        });
      } else if (connectionReq.status !== "accepted") {
        connectionReq.status = "accepted";
        await connectionReq.save();
      }

      // ProjectRoom
      await ProjectRoom.create({
        projectPostId: projectRequest.projectPostId,
        roomId: `project_${projectRequest.projectPostId}`,
        ownerId,
        members: [ownerId, requesterId]
      });

      const notification = await Notification.create({
        userId: requesterId,
        actorIds: [ownerId],
        type: "project_accepted",
        postId: projectRequest.projectPostId,
        projectRequestId: projectRequest._id
      });
      const populatedNotification = await notification.populate("actorIds", "firstName lastName photoUrl");
      const io = req.app.get("io");
      if (io) io.to(`user:${requesterId}`).emit("newNotification", populatedNotification);

      res.json({ message: "Request accepted successfully.", data: projectRequest });
    } else {
      projectRequest.status = "rejected";
      await projectRequest.save();

      const notification = await Notification.create({
        userId: projectRequest.requesterId,
        actorIds: [ownerId],
        type: "project_rejected",
        postId: projectRequest.projectPostId,
        projectRequestId: projectRequest._id
      });
      const populatedNotification = await notification.populate("actorIds", "firstName lastName photoUrl");
      const io = req.app.get("io");
      if (io) io.to(`user:${projectRequest.requesterId}`).emit("newNotification", populatedNotification);

      res.json({ message: "Request rejected.", data: projectRequest });
    }
  } catch (err) {
    res.status(400).json({ message: "Error: " + err.message });
  }
});

// GET /project/room/:roomId
router.get("/project/room/:roomId", userAuth, async (req, res) => {
  try {
    const { roomId } = req.params;
    const room = await ProjectRoom.findOne({ roomId })
      .populate("members", "firstName lastName photoUrl skills")
      .populate({
        path: "projectPostId",
        populate: { path: "authorId", select: "firstName lastName photoUrl" }
      })
      .populate("chats.senderId", "firstName lastName photoUrl");

    if (!room) {
      return res.status(404).json({ message: "Room not found." });
    }

    const isMember = room.members.some(member => member._id.toString() === req.user._id.toString());
    if (!isMember) {
      return res.status(403).json({ message: "You are not a member of this room." });
    }

    res.json({ data: room });
  } catch (err) {
    res.status(400).json({ message: "Error: " + err.message });
  }
});

// GET /project/room-by-members
router.get("/project/room-by-members", userAuth, async (req, res) => {
  try {
    const { userId } = req.query;
    if (!userId) {
      return res.status(400).json({ message: "userId query param is required." });
    }

    const room = await ProjectRoom.findOne({
      members: { $all: [req.user._id, userId] }
    });

    res.json({ data: room });
  } catch (err) {
    res.status(400).json({ message: "Error: " + err.message });
  }
});

module.exports = router;
