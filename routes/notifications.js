const express = require("express");
const router = express.Router();
const { userAuth } = require("../middlewares/auth");
const Notification = require("../models/Notification");

// GET /notifications — fetch recent notifications for logged-in user
router.get("/notifications", userAuth, async (req, res) => {
  try {
    const notifications = await Notification.find({
      userId: req.user._id,
    })
      .sort({ createdAt: -1 })
      .limit(20)
      .populate("fromUserId", "firstName lastName photoUrl")
      .populate("actorIds", "firstName lastName photoUrl");

    const unreadCount = await Notification.countDocuments({
      userId: req.user._id,
      read: false,
    });

    res.json({ notifications, unreadCount });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// PATCH /notifications/mark-read — mark all notifications as read
router.patch("/notifications/mark-read", userAuth, async (req, res) => {
  try {
    await Notification.updateMany(
      { userId: req.user._id, read: false },
      { $set: { read: true } }
    );
    res.json({ message: "All notifications marked as read" });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

module.exports = router;
