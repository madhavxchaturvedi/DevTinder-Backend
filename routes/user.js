const express = require("express");
const { userAuth } = require("../middlewares/auth");
const ConnectionRequestModel = require("../models/connectionRequest");
const router = express.Router();
const User = require("../models/User");
const Follow = require("../models/Follow");
const Post = require("../models/Post");
const ProjectRoom = require("../models/ProjectRoom");

const userAllowedData = [
  "firstName",
  "lastName",
  "photoUrl",
  "skills",
  "age",
  "about",
  "gender",
];

router.get("/user/request/received", userAuth, async (req, res) => {
  try {
    const loggedInUser = req.user;

    const connectionRequest = await ConnectionRequestModel.find({
      toUserId: loggedInUser._id,
      status: "interested",
    }).populate("fromUserId", userAllowedData);

    res.json({ message: "Data Fetched Successfully", data: connectionRequest });
  } catch (err) {
    res.status(400).json({ message: err.message });
  }
});

router.get("/user/connections", userAuth, async (req, res) => {
  try {
    const loggedInUser = req.user;

    const connectionRequest = await ConnectionRequestModel.find({
      $or: [
        { toUserId: loggedInUser._id, status: "accepted" },
        { fromUserId: loggedInUser._id, status: "accepted" },
      ],
    })
      .populate("fromUserId", userAllowedData)
      .populate("toUserId", userAllowedData);

    const data = connectionRequest.map((row) => {
      if (row.fromUserId._id.toString() === loggedInUser._id.toString()) {
        return row.toUserId;
      }
      return row.fromUserId;
    });

    res.json({ data });
  } catch (err) {
    res.status(400).json({ message: err.message });
  }
});

router.get("/feed", userAuth, async (req, res) => {
  try {
    const loggedInUser = req.user;

    const page = parseInt(req.query.page) || 1;
    let limit = parseInt(req.query.limit) || 10;
    limit = limit > 50 ? 50 : limit;
    const skip = (page - 1) * limit;

    const connectionRequest = await ConnectionRequestModel.find({
      $or: [{ fromUserId: loggedInUser }, { toUserId: loggedInUser }],
    }).select("fromUserId toUserId status");

    const hideUsersFromFeed = new Set();
    connectionRequest.forEach((req) => {
      // Hide users I have already swiped on
      if (req.fromUserId.toString() === loggedInUser._id.toString()) {
        hideUsersFromFeed.add(req.toUserId.toString());
      }
      // Hide users we are already matched or rejected with
      if (req.status === "accepted" || req.status === "rejected") {
        hideUsersFromFeed.add(req.fromUserId.toString());
        hideUsersFromFeed.add(req.toUserId.toString());
      }
    });

    const query = {
      $and: [
        { _id: { $nin: Array.from(hideUsersFromFeed) } },
        { _id: { $ne: loggedInUser._id } },
      ],
    };

    if (req.query.skills) {
      const skillsArray = req.query.skills.split(",").map((s) => s.trim());
      query.$and.push({
        skills: {
          $in: skillsArray.map((skill) => new RegExp(`^${skill}$`, "i")),
        },
      });
    }

    const users = await User.find(query)
      .select(userAllowedData)
      .skip(skip)
      .limit(limit);

    // Get logged-in user's skills for comparison
    const mySkills = (loggedInUser.skills || []).map(s => s.toLowerCase());

    // Enrich and score each candidate
    const enrichedUsers = await Promise.all(users.map(async (u) => {
      const userObj = u.toObject();
      const theirSkills = (userObj.skills || []).map(s => s.toLowerCase());
      
      // Compute shared vs other skills
      const sharedSkills = (userObj.skills || []).filter(s => mySkills.includes(s.toLowerCase()));
      const otherSkills = (userObj.skills || []).filter(s => !mySkills.includes(s.toLowerCase()));
      
      // Compatibility percent (shown on card badge)
      const compatibilityPercent = theirSkills.length > 0 
        ? Math.round((sharedSkills.length / theirSkills.length) * 100) 
        : 0;
      
      // Activity signals
      const oneWeekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
      const postCountThisWeek = await Post.countDocuments({ 
        authorId: userObj._id, 
        createdAt: { $gte: oneWeekAgo } 
      });
      const activeProjectRooms = await ProjectRoom.countDocuments({
        members: userObj._id,
        status: 'active'
      });

      // Fetch the latest featured post (prefer snippet or project, fallback to any)
      const latestPost = await Post.findOne({ authorId: userObj._id })
        .sort({ createdAt: -1 })
        .lean();
      
      // Internal ranking score (NOT sent to frontend)
      const threeDaysAgo = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000);
      const recencyBonus = userObj.updatedAt >= threeDaysAgo ? 20 
        : userObj.updatedAt >= oneWeekAgo ? 10 : 0;
      const activityBonus = postCountThisWeek > 0 ? 10 : 0;
      const _rankingScore = (sharedSkills.length * 30) + activityBonus + recencyBonus;
      
      return {
        ...userObj,
        sharedSkills,
        otherSkills,
        compatibilityPercent,
        activitySignals: { postCountThisWeek, activeProjectRooms },
        featuredPost: latestPost || null,
        _rankingScore // internal, stripped before response
      };
    }));

    // Sort by ranking score descending
    enrichedUsers.sort((a, b) => b._rankingScore - a._rankingScore);

    // Strip internal score before sending
    const result = enrichedUsers.map(({ _rankingScore, ...rest }) => rest);

    res.json({ data: result });
  } catch (err) {
    res.status(400).json({ message: err.message });
  }
});

// ── Follow / Unfollow ──────────────────────────────────────────

router.post("/user/follow/:targetId", userAuth, async (req, res) => {
  try {
    const loggedInUserId = req.user._id;
    const targetId = req.params.targetId;

    if (loggedInUserId.toString() === targetId.toString()) {
      return res.status(400).json({ message: "You cannot follow yourself" });
    }

    const targetUser = await User.findById(targetId);
    if (!targetUser) {
      return res.status(404).json({ message: "User not found" });
    }

    // Check if already following
    const existingFollow = await Follow.findOne({
      followerId: loggedInUserId,
      targetId: targetId,
    });

    if (existingFollow) {
      return res.status(400).json({ message: "Already following this user" });
    }

    const follow = new Follow({
      followerId: loggedInUserId,
      targetId: targetId,
    });
    
    try {
      await follow.save();
    } catch (saveErr) {
      if (saveErr.code === 11000) {
        return res.status(400).json({ message: "Already following this user" });
      }
      throw saveErr;
    }

    // Increment counts
    await User.findByIdAndUpdate(loggedInUserId, { $inc: { followingCount: 1 } });
    await User.findByIdAndUpdate(targetId, { $inc: { followersCount: 1 } });

    // Fire Notification for follow (upsert pattern for batching)
    const Notification = require("../models/Notification");
    const notification = await Notification.findOneAndUpdate(
      { userId: targetId, type: "follow", read: false },
      { $addToSet: { actorIds: loggedInUserId }, $set: { updatedAt: new Date() } },
      { upsert: true, new: true }
    ).populate("actorIds", "firstName lastName photoUrl");

    const io = req.app.get("io");
    if (io) io.to(`user:${targetId}`).emit("newNotification", notification);

    res.json({ message: "Successfully followed user", data: follow });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

router.post("/user/unfollow/:targetId", userAuth, async (req, res) => {
  try {
    const loggedInUserId = req.user._id;
    const targetId = req.params.targetId;

    const deletedFollow = await Follow.findOneAndDelete({
      followerId: loggedInUserId,
      targetId: targetId,
    });

    if (!deletedFollow) {
      return res.status(400).json({ message: "You are not following this user" });
    }

    // Decrement counts (ensure they don't go below 0 just in case)
    await User.findByIdAndUpdate(loggedInUserId, { $inc: { followingCount: -1 } });
    await User.findByIdAndUpdate(targetId, { $inc: { followersCount: -1 } });

    res.json({ message: "Successfully unfollowed user" });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// GET /user/:userId/latest-post — Fetch a single user's latest featured post
router.get("/user/:userId/latest-post", userAuth, async (req, res) => {
  try {
    const latestPost = await Post.findOne({ authorId: req.params.userId })
      .sort({ createdAt: -1 })
      .lean();
    res.json({ data: latestPost });
  } catch (err) {
    res.status(400).json({ message: err.message });
  }
});

// GET /user/best-matches — Top 4 users by compatibility score
router.get("/user/best-matches", userAuth, async (req, res) => {
  try {
    const loggedInUser = req.user;
    const mySkills = (loggedInUser.skills || []).map(s => s.toLowerCase());
    
    if (mySkills.length === 0) {
      return res.json({ data: [] });
    }

    // Get users who share at least one skill
    const connectionRequests = await ConnectionRequestModel.find({
      $or: [{ fromUserId: loggedInUser._id }, { toUserId: loggedInUser._id }],
    }).select("fromUserId toUserId");

    const excludeIds = new Set();
    connectionRequests.forEach((r) => {
      excludeIds.add(r.fromUserId.toString());
      excludeIds.add(r.toUserId.toString());
    });
    excludeIds.add(loggedInUser._id.toString());

    const candidates = await User.find({
      _id: { $nin: Array.from(excludeIds) },
      skills: { $in: mySkills.map(s => new RegExp(`^${s}$`, "i")) }
    })
    .select("firstName lastName photoUrl skills")
    .limit(20);

    const scored = candidates.map(u => {
      const userObj = u.toObject();
      const sharedSkills = (userObj.skills || []).filter(s => mySkills.includes(s.toLowerCase()));
      const compatibilityPercent = userObj.skills?.length > 0
        ? Math.round((sharedSkills.length / userObj.skills.length) * 100)
        : 0;
      return { ...userObj, sharedSkills, compatibilityPercent };
    });

    scored.sort((a, b) => b.compatibilityPercent - a.compatibilityPercent);

    res.json({ data: scored.slice(0, 4) });
  } catch (err) {
    res.status(400).json({ message: err.message });
  }
});

// GET /user/network-stats — Connection count, pending count, weekly connections
router.get("/user/network-stats", userAuth, async (req, res) => {
  try {
    const userId = req.user._id;
    const oneWeekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);

    const [connectionCount, pendingCount, connectionsThisWeek] = await Promise.all([
      ConnectionRequestModel.countDocuments({
        $or: [{ fromUserId: userId }, { toUserId: userId }],
        status: "accepted"
      }),
      ConnectionRequestModel.countDocuments({
        toUserId: userId,
        status: "interested"
      }),
      ConnectionRequestModel.countDocuments({
        $or: [{ fromUserId: userId }, { toUserId: userId }],
        status: "accepted",
        updatedAt: { $gte: oneWeekAgo }
      })
    ]);

    res.json({ connectionCount, pendingCount, connectionsThisWeek });
  } catch (err) {
    res.status(400).json({ message: err.message });
  }
});

module.exports = router;
