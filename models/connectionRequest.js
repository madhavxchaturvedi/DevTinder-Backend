const mongoose = require("mongoose");

const connectionRequestSchema = new mongoose.Schema(
  {
    fromUserId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    toUserId: {
      type: mongoose.Schema.Types.ObjectId,
      ref:"User",
      required: true,
    },
    status: {
      type: String,
      required: true,
      enum: {
        values: ["ignored", "interested", "accepted", "rejected"],
        message: `{VALUE} is incorrect status type`,
      },
    },
  },
  { timestamps: true }
);

connectionRequestSchema.index({ fromUserId: 1, toUserId: 1 });

connectionRequestSchema.pre("save", async function () {
  const connectionRequest = this;
  //Check if the fromUserId is same as toUserId
  if (connectionRequest.fromUserId && connectionRequest.toUserId && connectionRequest.fromUserId.equals(connectionRequest.toUserId)) {
    throw new Error("Can't send connection request to yourself!");
  }

  if (connectionRequest.isNew) {
    const existing = await this.constructor.findOne({
      $or: [
        { fromUserId: connectionRequest.fromUserId, toUserId: connectionRequest.toUserId },
        { fromUserId: connectionRequest.toUserId, toUserId: connectionRequest.fromUserId },
      ],
    });
    if (existing) {
      throw new Error("Connection request already exists between these users!");
    }
  }
});

const ConnectionRequest = new mongoose.model(
  "ConnectionRequest",
  connectionRequestSchema
);

module.exports = ConnectionRequest;
