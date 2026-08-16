const mongoose = require("mongoose");

const projectRoomSchema = new mongoose.Schema(
  {
    projectPostId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Post",
      required: true,
      unique: true,
    },
    roomId: {
      type: String,
      required: true,
      unique: true,
    },
    ownerId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    members: [
      {
        type: mongoose.Schema.Types.ObjectId,
        ref: "User",
      },
    ],
    lastCode: {
      type: String,
      default: "",
    },
    lastLanguage: {
      type: String,
      default: "javascript",
    },
    files: [
      {
        name: String,
        content: String,
        language: String,
      },
    ],
  },
  { timestamps: true }
);

const ProjectRoom = mongoose.model("ProjectRoom", projectRoomSchema);
module.exports = ProjectRoom;
