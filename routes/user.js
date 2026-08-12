const express = require("express");
const { userAuth } = require("../middlewares/auth");
const ConnectionRequestModel = require("../models/connectionRequest");
const router = express.Router();
const User = require("../models/User");
const Follow = require("../models/Follow");

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

    res.json({ data: users });
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

module.exports = router;
