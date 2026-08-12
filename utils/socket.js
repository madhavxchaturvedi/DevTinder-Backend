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

    // ── Chat: Typing indicator ──────────────────────────────────
    socket.on("typing", ({ targetId, isTyping }) => {
      const roomId = [socket.userId, targetId].sort().join("_");
      socket.to(roomId).emit("userTyping", { userId: socket.userId, isTyping });
    });

    // ── Sandbox: Join a live coding room ────────────────────────
    socket.on("joinSandbox", ({ roomId }) => {
      socket.join(roomId);
      console.log(`💻 User ${socket.userId} joined sandbox room: ${roomId}`);
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

    // ── Sandbox: Handle in-sandbox chat ─────────────────────────
    socket.on("sandboxMessage", ({ roomId, message, user }) => {
      io.to(roomId).emit("receiveSandboxMessage", { message, user, timestamp: new Date() });
    });

    socket.on("disconnect", () => {
      console.log(`🔌 User disconnected: ${socket.userId}`);
    });
  });

  return io;
};

module.exports = initializeSocket;
