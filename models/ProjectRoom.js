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
    tasks: [
      {
        title: { type: String, required: true },
        completed: { type: Boolean, default: false },
        assignedTo: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
        createdAt: { type: Date, default: Date.now }
      }
    ],
    chats: [
      {
        senderId: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
        text: { type: String, required: true },
        type: { type: String, default: 'user' },
        createdAt: { type: Date, default: Date.now }
      }
    ]
  },
  { timestamps: true }
);

const ProjectRoom = mongoose.model("ProjectRoom", projectRoomSchema);
module.exports = ProjectRoom;
