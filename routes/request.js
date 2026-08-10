const express = require("express");
const router = express.Router();
const { userAuth } = require("../middlewares/auth");
const ConnectionRequestModel = require("../models/connectionRequest.js");
const User = require("../models/User");
const Notification = require("../models/Notification");

// const sendEmail = require("../utils/sendEmail");

router.post("/request/send/:status/:toUserId", userAuth, async (req, res) => {
  try {
    const fromUserId = req.user._id;
    const toUserId = req.params.toUserId;
    const status = req.params.status;

    const isAllowedStatus = ["ignored", "interested"];

    if (!isAllowedStatus.includes(status)) {
      return res
        .status(400)
        .json({ message: "Invalid Status Type: " + status });
    }

    const toUser = await User.findById(toUserId);
    if (!toUser) {
      return res.status(400).json({ message: "User does not Exist!" });
    }

    const existingConnectionReqest = await ConnectionRequestModel.findOne({
      $or: [
        { fromUserId, toUserId },
        { fromUserId: toUserId, toUserId: fromUserId },
      ],
    });

    if (existingConnectionReqest) {
      return res
        .status(400)
        .json({ message: "Connection Request Already Exists!" });
    }

    const connectionRequest = new ConnectionRequestModel({
      fromUserId,
      toUserId,
      status,
    });

    const data = await connectionRequest.save();

    // Only notify the target user if the status is "interested"
    if (status === "interested") {
      // Create a persistent notification in DB
      const notification = await Notification.create({
        userId: toUserId,
        fromUserId,
        type: "connection_request",
        connectionRequestId: data._id,
      });

      // Populate fromUserId for the real-time payload
      const populatedNotification = await notification.populate(
        "fromUserId",
        "firstName lastName photoUrl"
      );

      // Emit real-time notification to the target user's personal room
      const io = req.app.get("io");
      if (io) {
        io.to(`user:${toUserId}`).emit("newNotification", populatedNotification);
      }
    }

    res.json({ message: "Connection Request Send SuccessFully", data });
  } catch (err) {
    res.status(400).send("ERROR : " + err.message);
  }
});

router.post(
  "/request/review/:status/:requestId",
  userAuth,
  async (req, res) => {
    try {
      const loggedInUser = req.user;
      const { status, requestId } = req.params;

      const allowedStatus = ["accepted", "rejected"];

      if (!allowedStatus.includes(status)) {
        return res.status(400).json({ message: "Status not Valid!" });
      }

      const connectionRequest = await ConnectionRequestModel.findOne({
        _id: requestId,
        toUserId: loggedInUser._id,
        status: "interested",
      });

      if (!connectionRequest) {
        return res
          .status(404)
          .json({ message: "Connection Request Not Found!" });
      }

      connectionRequest.status = status;
      const data = await connectionRequest.save();

      // Notify the original sender if their request was accepted
      if (status === "accepted") {
        const notification = await Notification.create({
          userId: connectionRequest.fromUserId,
          fromUserId: loggedInUser._id,
          type: "request_accepted",
          connectionRequestId: data._id,
        });

        const populatedNotification = await notification.populate(
          "fromUserId",
          "firstName lastName photoUrl"
        );

        const io = req.app.get("io");
        if (io) {
          io.to(`user:${connectionRequest.fromUserId}`).emit(
            "newNotification",
            populatedNotification
          );
        }
      }

      res.json({ message: "Connection Request " + status, data });
    } catch (err) {
      res.status(400).json({ message: "Error:" + err.message });
    }
  }
);

module.exports = router;
