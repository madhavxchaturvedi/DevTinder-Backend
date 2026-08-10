const express = require("express");
const router = express.Router();
const { userAuth } = require("../middlewares/auth");
const Message = require("../models/Message");
const ConnectionRequestModel = require("../models/connectionRequest");
const User = require("../models/User");

// GET /chat/:targetId  — fetch message history between logged-in user and target
router.get("/chat/:targetId", userAuth, async (req, res) => {
  try {
    const loggedInUserId = req.user._id;
    const { targetId } = req.params;
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 50;
    const skip = (page - 1) * limit;

    // Security: Only allow chat between accepted connections
    const connection = await ConnectionRequestModel.findOne({
      $or: [
        { fromUserId: loggedInUserId, toUserId: targetId, status: "accepted" },
        { fromUserId: targetId, toUserId: loggedInUserId, status: "accepted" },
      ],
    });

    if (!connection) {
      return res
        .status(403)
        .json({ message: "You can only chat with your connections." });
    }

    // Fetch the target user's basic info
    const targetUser = await User.findById(targetId).select(
      "firstName lastName photoUrl"
    );

    if (!targetUser) {
      return res.status(404).json({ message: "User not found." });
    }

    // Fetch messages (both directions), newest last
    const messages = await Message.find({
      $or: [
        { senderId: loggedInUserId, receiverId: targetId },
        { senderId: targetId, receiverId: loggedInUserId },
      ],
    })
      .sort({ createdAt: 1 })
      .skip(skip)
      .limit(limit)
      .populate("senderId", "firstName photoUrl");

    // Mark incoming messages as seen
    await Message.updateMany(
      { senderId: targetId, receiverId: loggedInUserId, seen: false },
      { $set: { seen: true } }
    );

    res.json({ messages, targetUser });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

module.exports = router;
