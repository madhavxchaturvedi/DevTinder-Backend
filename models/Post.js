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
      enum: ["standard", "snippet", "debug_sos", "project"],
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
    images: {
      type: [String],
      validate: [arrayLimit, '{PATH} exceeds the limit of 4'],
    },
    documentUrl: {
      type: String,
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
    project: {
      title:           { type: String, maxLength: 100 },
      techStack:       [{ type: String, trim: true, lowercase: true }],
      roleNeeded:      { type: String, maxLength: 200 },
      commitment:      { type: String, enum: ["one-time", "ongoing"], default: "ongoing" },
      stage:           { type: String, enum: ["idea", "early-build", "mid-build", "needs-review"], default: "idea" },
      isOpen:          { type: Boolean, default: true },
    },
  },
  { timestamps: true }
);

function arrayLimit(val) {
  return val.length <= 4;
}

// Indexes for fast feed queries
postSchema.index({ authorId: 1, createdAt: -1 });
postSchema.index({ createdAt: -1 });
postSchema.index({ stackTags: 1, createdAt: -1 });
postSchema.index({ type: 1, "project.isOpen": 1, createdAt: -1 });
postSchema.index({ "project.techStack": 1, createdAt: -1 });

const Post = mongoose.model("Post", postSchema);
module.exports = Post;
