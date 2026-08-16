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
      // Legacy or single-actor fallback
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
    },
    actorIds: [{
      // Array of users who triggered this (for batched notifications like reactions)
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
    }],
    type: {
      type: String,
      enum: ["connection_request", "request_accepted", "request_rejected", "reaction", "comment", "fork", "follow", "match", "project_join_request", "project_accepted", "project_rejected", "partner_in_room"],
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
    postId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Post",
    },
    commentId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Comment",
    },
    projectRequestId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "ProjectRequest",
    },
  },
  { timestamps: true }
);

notificationSchema.index({ userId: 1, read: 1, createdAt: -1 });

const Notification = mongoose.model("Notification", notificationSchema);
module.exports = Notification;
