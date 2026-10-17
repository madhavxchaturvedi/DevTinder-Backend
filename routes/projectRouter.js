const express = require("express");
const router = express.Router();
const mongoose = require("mongoose");
const { userAuth } = require("../middlewares/auth");
const Post = require("../models/Post");
const ProjectRequest = require("../models/ProjectRequest");
const ProjectRoom = require("../models/ProjectRoom");
const Notification = require("../models/Notification");
const ConnectionRequestModel = require("../models/connectionRequest");
const User = require("../models/User");

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

    const userRequestsMap = existingRequests.reduce((acc, req) => {
      acc[req.projectPostId.toString()] = req.status || "pending";
      return acc;
    }, {});

    // Count pending requests per project
    const pendingRequests = await ProjectRequest.aggregate([
      { $match: { projectPostId: { $in: postIds }, status: "pending" } },
      { $group: { _id: "$projectPostId", count: { $sum: 1 } } }
    ]);

    const requestCountsMap = pendingRequests.reduce((acc, req) => {
      acc[req._id.toString()] = req.count;
      return acc;
    }, {});
    const requestCounts = requestCountsMap;

    const postsWithRequestStatus = posts.map(p => {
      const postObj = p.toObject();
      postObj.hasRequested = !!userRequestsMap[p._id.toString()];
      return postObj;
    });

    res.json({
      message: "Projects fetched",
      data: postsWithRequestStatus,
      requestCounts,
      requestCountsMap,
      userRequestsMap,
      success: true,
    });
  } catch (err) {
    res.status(400).json({ message: err.message, success: false });
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
      return res.status(404).json({ message: "Project post not found.", success: false });
    }

    if (!post.project.isOpen) {
      return res.status(400).json({ message: "Project is no longer open.", success: false });
    }

    if (post.authorId.toString() === requesterId.toString()) {
      return res.status(400).json({ message: "You cannot request to join your own project.", success: false });
    }

    const existingRequest = await ProjectRequest.findOne({ projectPostId: postId, requesterId });
    if (existingRequest) {
      return res.status(400).json({ message: "You have already sent a request.", success: false });
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
    res.status(400).json({ message: err.message, success: false });
  }
});

// GET /project/:postId/requests
router.get("/project/:postId/requests", userAuth, async (req, res) => {
  try {
    const { postId } = req.params;

    const post = await Post.findById(postId);
    if (!post) {
      return res.status(404).json({ message: "Post not found.", success: false });
    }

    if (post.authorId.toString() !== req.user._id.toString()) {
      return res.status(403).json({ message: "Only the post author can view requests.", success: false });
    }

    const requests = await ProjectRequest.find({ projectPostId: postId })
      .populate("requesterId", "firstName lastName photoUrl skills about")
      .sort({ createdAt: -1 });

    res.json({ data: requests, success: true });
  } catch (err) {
    res.status(400).json({ message: err.message, success: false });
  }
});

// POST /project/review/:requestId/:status
router.post(
  [
    "/project/review/:requestId/:status",
    "/project/request/review/:requestId/:status",
    "/project/review/:status/:requestId",
    "/project/request/review/:status/:requestId",
  ],
  userAuth,
  async (req, res) => {
    try {
      const status = ["accepted", "rejected"].includes(req.params.status)
        ? req.params.status
        : req.params.requestId;
      const requestId = ["accepted", "rejected"].includes(req.params.status)
        ? req.params.requestId
        : req.params.status;
      const ownerId = req.user._id;

      if (!["accepted", "rejected"].includes(status)) {
        return res.status(400).json({ message: "Invalid status.", success: false });
      }

      const projectRequest = await ProjectRequest.findById(requestId);
      if (!projectRequest) {
        return res.status(404).json({ message: "Project request not found.", success: false });
      }

      if (projectRequest.ownerId.toString() !== ownerId.toString()) {
        return res.status(403).json({ message: "Unauthorized.", success: false });
      }

      if (projectRequest.status !== "pending") {
        return res.status(400).json({ message: "Request is already processed.", success: false });
      }

      if (status === "accepted") {
        // Free tier room limit check: Free tier users (user.isPremium !== true) up to 1 active project room.
        if (req.user.isPremium !== true) {
          const ownerActiveRooms = await ProjectRoom.countDocuments({
            $or: [{ ownerId }, { members: ownerId }],
            status: { $nin: ["completed", "archived"] },
          });
          if (ownerActiveRooms >= 1) {
            return res.status(403).json({
              success: false,
              message: "Free tier is limited to 1 active room. Upgrade to Pro for unlimited rooms.",
            });
          }
        }

        // Check requester if requester is also on Free tier
        const requesterId = projectRequest.requesterId?._id || projectRequest.requesterId;
        const requesterUser = await User.findById(requesterId);
        if (requesterUser && requesterUser.isPremium !== true) {
          const requesterActiveRooms = await ProjectRoom.countDocuments({
            $or: [{ ownerId: requesterId }, { members: requesterId }],
            status: { $nin: ["completed", "archived"] },
          });
          if (requesterActiveRooms >= 1) {
            return res.status(403).json({
              success: false,
              message: "Free tier is limited to 1 active room. Upgrade to Pro for unlimited rooms.",
            });
          }
        }

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
      const projectTitle = post?.project?.title || "Untitled Project";
      
      await ProjectRoom.create({
        projectPostId: projectRequest.projectPostId,
        roomId: `project_${projectRequest.projectPostId}`,
        ownerId,
        members: [ownerId, requesterId],
        title: projectTitle
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
    res.status(400).json({ message: err.message, success: false });
  }
});

// POST /project/room or /project/room/create
router.post(["/project/room", "/project/room/create"], userAuth, async (req, res) => {
  try {
    if (req.user.isPremium !== true) {
      const activeRooms = await ProjectRoom.countDocuments({
        $or: [{ ownerId: req.user._id }, { members: req.user._id }],
        status: { $nin: ["completed", "archived"] },
      });
      if (activeRooms >= 1) {
        return res.status(403).json({
          success: false,
          message: "Free tier is limited to 1 active room. Upgrade to Pro for unlimited rooms.",
        });
      }
    }

    const { projectPostId, title, template, members, files, lastCode, lastLanguage } = req.body;
    const roomId = req.body.roomId || `project_${projectPostId || Date.now()}`;
    const initialMembers = Array.isArray(members) && members.length > 0
      ? Array.from(new Set([req.user._id.toString(), ...members.map((m) => (m?._id || m).toString())]))
      : [req.user._id];

    if (Array.isArray(members) && members.length > 0) {
      for (const mId of members) {
        const idToCheck = mId?._id || mId;
        if (idToCheck.toString() !== req.user._id.toString()) {
          const mUser = await User.findById(idToCheck);
          if (mUser && mUser.isPremium !== true) {
            const mActiveRooms = await ProjectRoom.countDocuments({
              $or: [{ ownerId: idToCheck }, { members: idToCheck }],
              status: { $nin: ["completed", "archived"] },
            });
            if (mActiveRooms >= 1) {
              return res.status(403).json({
                success: false,
                message: "Free tier is limited to 1 active room. Upgrade to Pro for unlimited rooms.",
              });
            }
          }
        }
      }
    }

    const room = await ProjectRoom.create({
      projectPostId: projectPostId || new mongoose.Types.ObjectId(),
      roomId,
      ownerId: req.user._id,
      members: initialMembers,
      title: title || "Untitled Project",
      template: template || "react",
      files: files || {},
      lastCode: lastCode || "",
      lastLanguage: lastLanguage || "javascript",
    });

    res.status(201).json({
      success: true,
      message: "Project room created successfully.",
      data: room,
    });
  } catch (err) {
    res.status(400).json({ success: false, message: err.message });
  }
});

// GET /project/room/public/:roomId
router.get("/project/room/public/:roomId", async (req, res) => {
  try {
    const { roomId } = req.params;
    // Only return code, avoid leaking chat or PII to the public
    const room = await ProjectRoom.findOne({ roomId }, "files template lastCode");
    if (!room) {
      return res.status(404).json({ message: "Room not found.", success: false });
    }
    res.json({ data: room, success: true });
  } catch (err) {
    res.status(400).json({ message: err.message, success: false });
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
      return res.status(404).json({ message: "Room not found.", success: false });
    }

    const isMember = room.members.some(member => member._id.toString() === req.user._id.toString());
    if (!isMember) {
      return res.status(403).json({ message: "You are not a member of this room.", success: false });
    }

    res.json({ data: room, success: true });
  } catch (err) {
    res.status(400).json({ message: err.message, success: false });
  }
});

// GET /project/room-by-members
router.get("/project/room-by-members", userAuth, async (req, res) => {
  try {
    const { userId } = req.query;
    if (!userId) {
      return res.status(400).json({ message: "userId query param is required.", success: false });
    }

    const rooms = await ProjectRoom.find({
      members: { $all: [req.user._id, userId] },
      status: { $ne: "archived" }
    }).populate({
      path: "projectPostId",
      select: "content project"
    }).sort({ updatedAt: -1 });

    res.json({ data: rooms });
  } catch (err) {
    res.status(400).json({ message: err.message, success: false });
  }
});

// GET /project/my-rooms
router.get("/project/my-rooms", userAuth, async (req, res) => {
  try {
    const { status } = req.query;
    const query = { members: req.user._id };
    if (status && ["active", "completed", "archived"].includes(status)) {
      query.status = status;
    }

    const rooms = await ProjectRoom.find(query)
      .populate("members", "firstName lastName photoUrl skills")
      .populate({
        path: "projectPostId",
        select: "content project",
        populate: { path: "authorId", select: "firstName lastName photoUrl" }
      })
      .sort({ updatedAt: -1 });

    res.json({ data: rooms });
  } catch (err) {
    res.status(400).json({ message: err.message, success: false });
  }
});

// PATCH /project/room/:roomId/status
router.patch("/project/room/:roomId/status", userAuth, async (req, res) => {
  try {
    const { roomId } = req.params;
    const { status } = req.body;

    if (!["active", "completed", "archived"].includes(status)) {
      return res.status(400).json({ message: "Invalid status. Must be active, completed, or archived.", success: false });
    }

    const room = await ProjectRoom.findOne({ roomId });
    if (!room) return res.status(404).json({ message: "Room not found.", success: false });
    if (room.ownerId.toString() !== req.user._id.toString()) {
      return res.status(403).json({ message: "Only the project owner can change status.", success: false });
    }

    room.status = status;
    await room.save();
    res.json({ message: `Project marked as ${status}.`, data: room, success: true });
  } catch (err) {
    res.status(400).json({ message: err.message, success: false });
  }
});

// DELETE /project/room/:roomId
router.delete("/project/room/:roomId", userAuth, async (req, res) => {
  try {
    const { roomId } = req.params;
    const room = await ProjectRoom.findOne({ roomId });
    if (!room) return res.status(404).json({ message: "Room not found.", success: false });
    if (room.ownerId.toString() !== req.user._id.toString()) {
      return res.status(403).json({ message: "Only the project owner can delete this room.", success: false });
    }
    if (room.status === "completed") {
      return res.status(400).json({ message: "Completed projects cannot be deleted. You can archive them instead.", success: false });
    }

    await ProjectRoom.deleteOne({ roomId });
    res.json({ message: "Project room deleted successfully.", success: true });
  } catch (err) {
    res.status(400).json({ message: err.message, success: false });
  }
});

// GET /project/my-posts — Fetch user's project posts with pending request counts
router.get("/project/my-posts", userAuth, async (req, res) => {
  try {
    const posts = await Post.find({
      authorId: req.user._id,
      type: "project"
    })
    .select("content project createdAt")
    .sort({ createdAt: -1 });

    const postIds = posts.map(p => p._id);

    // Count pending requests per post
    const pendingRequests = await ProjectRequest.aggregate([
      { $match: { projectPostId: { $in: postIds }, status: "pending" } },
      { $group: { _id: "$projectPostId", count: { $sum: 1 } } }
    ]);

    const requestCounts = pendingRequests.reduce((acc, r) => {
      acc[r._id.toString()] = r.count;
      return acc;
    }, {});

    // Check which posts have been matched (have a ProjectRoom)
    const rooms = await ProjectRoom.find({ projectPostId: { $in: postIds } }).select("projectPostId roomId");
    const roomMap = rooms.reduce((acc, r) => {
      acc[r.projectPostId.toString()] = r.roomId;
      return acc;
    }, {});

    const postsWithCounts = posts.map(p => {
      const postObj = p.toObject();
      postObj.pendingRequestCount = requestCounts[p._id.toString()] || 0;
      postObj.roomId = roomMap[p._id.toString()] || null;
      postObj.isMatched = !!roomMap[p._id.toString()];
      return postObj;
    });

    res.json({ data: postsWithCounts });
  } catch (err) {
    res.status(400).json({ message: err.message, success: false });
  }
});

module.exports = router;
