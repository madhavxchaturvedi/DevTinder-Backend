const mongoose = require("mongoose");

const notificationSchema = new mongoose.Schema(
  {
    userId: {
      // who receives this notification
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    fromUserId: {
      // who triggered it
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    type: {
      type: String,
      enum: ["connection_request", "request_accepted", "request_rejected"],
      required: true,
    },
    read: {
      type: Boolean,
      default: false,
    },
    connectionRequestId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "ConnectionRequest",
    },
  },
  { timestamps: true }
);

notificationSchema.index({ userId: 1, read: 1, createdAt: -1 });

const Notification = mongoose.model("Notification", notificationSchema);
module.exports = Notification;
