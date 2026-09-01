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
    files: {
      type: mongoose.Schema.Types.Mixed,
      default: {},
    },
    template: {
      type: String,
      default: "react",
      enum: ["react", "vue", "angular"],
    },
    status: { type: String, default: "active", enum: ["active", "completed", "archived"] },
    title: { type: String, default: "" },
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
