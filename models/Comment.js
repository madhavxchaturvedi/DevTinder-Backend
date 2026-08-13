const mongoose = require("mongoose");

const commentSchema = new mongoose.Schema(
  {
    postId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Post",
      required: true,
    },
    authorId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    text: {
      type: String,
      required: true,
      trim: true,
      maxLength: 2000,
    },
    isResolvedAnswer: {
      type: Boolean,
      default: false,
    },
  },
  { timestamps: true }
);

// Index for fetching comments on a post efficiently
commentSchema.index({ postId: 1, createdAt: 1 });

const Comment = mongoose.model("Comment", commentSchema);
module.exports = Comment;
