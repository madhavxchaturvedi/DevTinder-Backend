const mongoose = require("mongoose");

const reactionSchema = new mongoose.Schema(
  {
    postId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Post",
      required: true,
    },
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    type: {
      type: String,
      enum: ["fire", "bug", "clever", "collab"],
      required: true,
    },
  },
  { timestamps: true }
);

// Ensure a user can only leave ONE reaction per post. 
// Note: If they change their reaction (e.g. fire to bug), we must decrement the old count and increment the new count on the Post document before updating this log.
reactionSchema.index({ postId: 1, userId: 1 }, { unique: true });

const Reaction = mongoose.model("Reaction", reactionSchema);
module.exports = Reaction;
