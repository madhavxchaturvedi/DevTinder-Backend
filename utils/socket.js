const { Server } = require("socket.io");
const jwt = require("jsonwebtoken");
const cookie = require("cookie");
const Message = require("../models/Message");
const ConnectionRequestModel = require("../models/connectionRequest");

const initializeSocket = (server) => {
  const allowedOrigins = [
    "http://localhost:5173",
    "https://devxtinder.vercel.app",
    process.env.FRONTEND_URL,
  ].filter(Boolean);

  const io = new Server(server, {
    cors: {
      origin: allowedOrigins,
      credentials: true,
    },
  });

  // Socket.io auth middleware — verify JWT from cookie
  io.use((socket, next) => {
    try {
      const rawCookies = socket.handshake.headers.cookie || "";
      const cookies = cookie.parse(rawCookies);
      const token = cookies.token;

      if (!token) {
        return next(new Error("Authentication error: No token found"));
      }

      const decoded = jwt.verify(token, process.env.JWT_SECRET_KEY);
      socket.userId = decoded._id.toString();
      next();
    } catch (err) {
      next(new Error("Authentication error: " + err.message));
    }
  });

  io.on("connection", (socket) => {
    console.log(`🔌 User connected: ${socket.userId}`);
    
    // Recalculate and broadcast online users
    const connectedUsers = new Set(Array.from(io.sockets.sockets.values()).map(s => s.userId).filter(Boolean));
    io.emit("onlineUsers", Array.from(connectedUsers));

    // ── Personal notification room ──────────────────────────────
    // Every user auto-joins their own room so they can receive
    // real-time notifications from anywhere in the app
    socket.join(`user:${socket.userId}`);

    // ── Chat: Join a private chat room ──────────────────────────
    // Room ID is always sorted so userId1_userId2 === userId2_userId1
    socket.on("joinChat", ({ targetId }) => {
      const roomId = [socket.userId, targetId].sort().join("_");
      socket.join(roomId);
      console.log(`💬 User ${socket.userId} joined room: ${roomId}`);
    });

    // ── Chat: Handle sending a message ──────────────────────────
    socket.on("sendMessage", async ({ targetId, text }) => {
      try {
        if (!text || !text.trim()) return;

        const connection = await ConnectionRequestModel.findOne({
          $or: [
            {
              fromUserId: socket.userId,
              toUserId: targetId,
              status: "accepted",
            },
            {
              fromUserId: targetId,
              toUserId: socket.userId,
              status: "accepted",
            },
          ],
        });

        if (!connection) {
          socket.emit("error", {
            message: "You can only chat with your connections.",
          });
          return;
        }

        const newMessage = await Message.create({
          senderId: socket.userId,
          receiverId: targetId,
          text: text.trim(),
        });

        const populated = await newMessage.populate(
          "senderId",
          "firstName photoUrl"
        );

        const roomId = [socket.userId, targetId].sort().join("_");
        io.to(roomId).emit("receiveMessage", populated);
      } catch (err) {
        console.error("sendMessage error:", err);
        socket.emit("error", { message: "Failed to send message." });
      }
    });

    socket.on("chat:system_message", async ({ targetId, text, type }) => {
      try {
        if (!text) return;

        const newMessage = await Message.create({
          senderId: socket.userId,
          receiverId: targetId,
          text: text,
          type: type || "system"
        });

        const populated = await newMessage.populate("senderId", "firstName photoUrl");
        const roomId = [socket.userId, targetId].sort().join("_");
        io.to(roomId).emit("receiveMessage", populated);
      } catch (err) {
        console.error("system message error:", err);
      }
    });

    // ── Chat: Typing indicator ──────────────────────────────────
    socket.on("typing", ({ targetId, isTyping }) => {
      const roomId = [socket.userId, targetId].sort().join("_");
      socket.to(roomId).emit("userTyping", { userId: socket.userId, isTyping });
    });

    // ── Sandbox: Join a live coding room ────────────────────────
    socket.on("joinSandbox", ({ roomId, userId }) => {
      socket.join(roomId);
      console.log(`💻 User ${socket.userId} joined sandbox room: ${roomId}`);
      if (userId) {
        socket.to(roomId).emit("userJoinedSandbox", { userId });
      }
    });

    socket.on("acknowledgeSandboxJoin", ({ roomId, userId }) => {
      socket.to(roomId).emit("userAlreadyInSandbox", { userId });
    });

    socket.on("leaveSandbox", ({ roomId, userId }) => {
      socket.leave(roomId);
      if (userId) {
        socket.to(roomId).emit("userLeftSandbox", { userId });
      }
    });

    // ── Sandbox: Presence Ping (for Chat UI) ────────────────────
    socket.on("pingSandboxPresence", ({ roomId }) => {
      socket.to(roomId).emit("sandboxPresencePing", { requesterId: socket.id });
    });

    socket.on("pongSandboxPresence", ({ targetSocketId, userId }) => {
      io.to(targetSocketId).emit("sandboxPresencePong", { userId });
    });

    // ── Sandbox: Handle code changes ────────────────────────────
    socket.on("codeChange", ({ roomId, code, language }) => {
      socket.to(roomId).emit("receiveCodeChange", { code, language });
    });

    // ── Sandbox: Handle cursor movements ────────────────────────
    socket.on("cursorMove", ({ roomId, position, userName }) => {
      socket.to(roomId).emit("receiveCursorMove", { userId: socket.userId, userName, position });
    });

    // ── Sandbox: Sync Output and Execution ──────────────────────
    socket.on("syncExecutionState", ({ roomId, isExecuting }) => {
      socket.to(roomId).emit("receiveExecutionState", { isExecuting });
    });

    socket.on("syncOutput", ({ roomId, output }) => {
      socket.to(roomId).emit("receiveOutput", { output });
    });

    // ── Sandbox: Late Join Sync ─────────────────────────────────
    socket.on("requestSandboxSync", ({ roomId }) => {
      // Ask others in the room to send their current state
      socket.to(roomId).emit("provideSandboxSync", { targetSocketId: socket.id });
    });

    socket.on("sendSandboxSync", ({ targetSocketId, code, language }) => {
      // Send state directly to the requester
      io.to(targetSocketId).emit("receiveCodeChange", { code, language });
    });

    // ── Sandbox: Handle in-sandbox chat ─────────────────────────
    socket.on("sandboxMessage", ({ roomId, message, user }) => {
      io.to(roomId).emit("receiveSandboxMessage", { message, user, timestamp: new Date() });
    });

    // ── Project Room ────────────────
    socket.on("enterProjectRoom", async ({ roomId, projectTitle }) => {
      socket.join(roomId);
      socket.to(roomId).emit("partnerEnteredRoom", { userId: socket.userId });
      
      // Notify partner even if they're not in the room yet
      const ProjectRoom = require("../models/ProjectRoom");
      const room = await ProjectRoom.findOne({ roomId });
      if (room) {
        const partnerId = room.members.find(m => m.toString() !== socket.userId.toString());
        if (partnerId) {
          io.to(`user:${partnerId}`).emit("newNotification", {
            type: "partner_in_room", 
            message: `Your partner is in the ${projectTitle || 'project'} room`,
            roomId
          });
        }
      }
    });

    socket.on("leaveProjectRoom", ({ roomId }) => {
      socket.leave(roomId);
      socket.to(roomId).emit("partnerLeftRoom", { userId: socket.userId });
    });

    socket.on("projectRoom:ping", ({ roomId }) => {
      socket.to(roomId).emit("projectRoom:ping", { fromSocketId: socket.id, userId: socket.userId });
    });

    socket.on("projectRoom:pong", ({ targetSocketId }) => {
      io.to(targetSocketId).emit("projectRoom:pong", { userId: socket.userId });
    });

    socket.on("saveProjectState", async ({ roomId, code, language }) => {
      const ProjectRoom = require("../models/ProjectRoom");
      await ProjectRoom.findOneAndUpdate({ roomId }, { lastCode: code, lastLanguage: language });
    });

    // ── WebRTC Signaling ────────────────
    socket.on("webrtc:join", ({ roomId }) => socket.to(roomId).emit("webrtc:join", { from: socket.userId }));
    socket.on("webrtc:offer", ({ roomId, offer }) => socket.to(roomId).emit("webrtc:offer", { offer, from: socket.userId }));
    socket.on("webrtc:answer", ({ roomId, answer }) => socket.to(roomId).emit("webrtc:answer", { answer, from: socket.userId }));
    socket.on("webrtc:ice", ({ roomId, candidate }) => socket.to(roomId).emit("webrtc:ice", { candidate, from: socket.userId }));
    socket.on("webrtc:end", ({ roomId }) => socket.to(roomId).emit("webrtc:end", { from: socket.userId }));
    socket.on("webrtc:media", ({ roomId, videoOff, muted }) => socket.to(roomId).emit("webrtc:media", { videoOff, muted, from: socket.userId }));
    socket.on("webrtc:reaction", ({ roomId, emoji }) => socket.to(roomId).emit("webrtc:reaction", { emoji, from: socket.userId }));

    // ── Project Room Tools ────────────────
    socket.on("room:tasks_update", async ({ roomId, tasks }) => {
      try {
        const ProjectRoom = require("../models/ProjectRoom");
        await ProjectRoom.findOneAndUpdate({ roomId }, { tasks });
        socket.to(roomId).emit("room:tasks_update", { tasks });
      } catch (err) {
        console.error("Error updating tasks", err);
      }
    });

    socket.on("room:chat_message", async ({ roomId, message }) => {
      try {
        const ProjectRoom = require("../models/ProjectRoom");
        await ProjectRoom.findOneAndUpdate({ roomId }, { $push: { chats: message } });
        io.to(roomId).emit("room:chat_message", { message });
      } catch (err) {
        console.error("Error sending chat message", err);
      }
    });

    socket.on("disconnecting", () => {
      // Broadcast leave event to all rooms this user was in (before they are cleared)
      for (const room of socket.rooms) {
        if (room !== `user:${socket.userId}` && room !== socket.id) {
          socket.to(room).emit("userLeftSandbox", { userId: socket.userId });
        }
      }
    });

    socket.on("disconnect", () => {
      console.log(`🔌 User disconnected: ${socket.userId}`);
      const connectedUsers = new Set(Array.from(io.sockets.sockets.values()).map(s => s.userId).filter(Boolean));
      io.emit("onlineUsers", Array.from(connectedUsers));
    });
  });

  return io;
};

module.exports = initializeSocket;
