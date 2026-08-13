require("dotenv").config();
const express = require("express");
const http = require("http");
const connectDB = require("./config/database");
const cookieParser = require("cookie-parser");
const cors = require("cors");
const initializeSocket = require("./utils/socket");

require("./utils/cronJob");

const authRouter = require("./routes/auth");
const profileRouter = require("./routes/profile");
const requestRouter = require("./routes/request");
const userRouter = require("./routes/user");
const paymentRouter = require("./routes/payment");
const chatRouter = require("./routes/chat");
const notificationsRouter = require("./routes/notifications");
const publicProfileRouter = require("./routes/publicProfile");
const postRouter = require("./routes/postRouter");
const commentRouter = require("./routes/comment");

const app = express();
const server = http.createServer(app); // wrap in http.Server for Socket.io

const allowedOrigins = [
  "http://localhost:5173",
  "https://devxtinder.vercel.app",
  process.env.FRONTEND_URL,
].filter(Boolean);

const corsOptions = {
  origin: function (origin, callback) {
    // Allow requests with no origin (like mobile apps or curl requests)
    if (!origin) return callback(null, true);

    if (
      allowedOrigins.includes(origin) ||
      origin.endsWith(".vercel.app") // Allow all Vercel preview deployments
    ) {
      callback(null, true);
    } else {
      callback(null, false);
    }
  },
  credentials: true, //access-control-allow-credentials:true
};
app.use(cors(corsOptions));

app.use(express.json());
app.use(cookieParser());

app.use("/", authRouter);
app.use("/", profileRouter);
app.use("/", requestRouter);
app.use("/", userRouter);
app.use("/", paymentRouter);
app.use("/", chatRouter);
app.use("/", notificationsRouter);
app.use("/", publicProfileRouter);
app.use("/", postRouter);
app.use("/", commentRouter);

// Initialize Socket.io on the HTTP server and store io on app
const io = initializeSocket(server);
app.set("io", io);

connectDB()
  .then(() => {
    console.log("Database connection established...");
    server.listen(process.env.PORT, () => {
      console.log(`server is successfully running on ${process.env.PORT}`);
    });
  })
  .catch((err) => {
    console.log("Database can't be connected!");
  });
