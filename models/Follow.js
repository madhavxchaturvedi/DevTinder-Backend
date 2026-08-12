const mongoose = require("mongoose");

const followSchema = new mongoose.Schema(
  {
    followerId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    targetId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
  },
  { timestamps: true }
);

// Prevent duplicate follows
followSchema.index({ followerId: 1, targetId: 1 }, { unique: true });

// Optimize "who follows me" queries (requested by user)
followSchema.index({ targetId: 1, followerId: 1 });

const Follow = mongoose.model("Follow", followSchema);
module.exports = Follow;
