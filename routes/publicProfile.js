const express = require("express");
const router = express.Router();
const { userAuth } = require("../middlewares/auth");
const User = require("../models/User");
const ConnectionRequestModel = require("../models/connectionRequest");

const PUBLIC_FIELDS = "firstName lastName photoUrl skills age about gender";

// GET /user/:userId — fetch public profile
// Also tells the viewer if they are connected with this user
router.get("/user/:userId", userAuth, async (req, res) => {
  try {
    const { userId } = req.params;
    const loggedInUserId = req.user._id;

    const targetUser = await User.findById(userId).select(PUBLIC_FIELDS);
    if (!targetUser) {
      return res.status(404).json({ message: "User not found" });
    }

    // Check connection status between logged-in user and target
    const connectionRequest = await ConnectionRequestModel.findOne({
      $or: [
        { fromUserId: loggedInUserId, toUserId: userId },
        { fromUserId: userId, toUserId: loggedInUserId },
      ],
    });

    let connectionStatus = "none"; // none | pending | accepted | ignored
    if (connectionRequest) {
      connectionStatus = connectionRequest.status; // interested | accepted | rejected | ignored
      if (connectionRequest.status === "interested") {
        connectionStatus = "pending";
      }
    }

    res.json({ user: targetUser, connectionStatus });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

module.exports = router;
