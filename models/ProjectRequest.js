const mongoose = require("mongoose");

const projectRequestSchema = new mongoose.Schema(
  {
    projectPostId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Post",
      required: true,
    },
    requesterId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    ownerId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    message: {
      type: String,
      maxLength: 300,
    },
    status: {
      type: String,
      enum: ["pending", "accepted", "rejected"],
      default: "pending",
    },
  },
  { timestamps: true }
);

projectRequestSchema.index({ projectPostId: 1, requesterId: 1 }, { unique: true });
projectRequestSchema.index({ ownerId: 1, status: 1 });

const ProjectRequest = mongoose.model("ProjectRequest", projectRequestSchema);
module.exports = ProjectRequest;
