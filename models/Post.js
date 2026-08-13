const mongoose = require("mongoose");

const postSchema = new mongoose.Schema(
  {
    authorId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    type: {
      type: String,
      enum: ["standard", "snippet", "debug_sos"],
      default: "standard",
    },
    content: {
      type: String,
      trim: true,
      maxLength: 3000,
      required: true,
    },
    codeSnippet: {
      language: { type: String },
      code: { type: String, maxLength: 10000 },
    },
    forkedFrom: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Post",
    },
    rootPostId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Post",
    },
    stackTags: [
      {
        type: String,
        trim: true,
        lowercase: true,
      },
    ],
    visibility: {
      type: String,
      enum: ["public", "followers", "matches"],
      default: "public",
    },
    isResolved: {
      type: Boolean,
      default: false,
    },
    moderationStatus: {
      type: String,
      enum: ["safe", "flagged", "hidden"],
      default: "safe",
    },
    reactions: {
      fire: { type: Number, default: 0 },
      bug: { type: Number, default: 0 },
      clever: { type: Number, default: 0 },
      collab: { type: Number, default: 0 },
    },
  },
  { timestamps: true }
);

// Indexes for fast feed queries
postSchema.index({ authorId: 1, createdAt: -1 });
postSchema.index({ createdAt: -1 });
postSchema.index({ stackTags: 1, createdAt: -1 });

const Post = mongoose.model("Post", postSchema);
module.exports = Post;
