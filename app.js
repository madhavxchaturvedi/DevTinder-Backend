require("dotenv").config();
const express = require("express");
const connectDB = require("./config/database");
const cookieParser = require("cookie-parser");
const cors = require("cors");

require("./utils/cronJob");

const authRouter = require("./routes/auth");
const profileRouter = require("./routes/profile");
const requestRouter = require("./routes/request");
const userRouter = require("./routes/user");
const paymentRouter = require("./routes/payment");

const app = express();

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

connectDB()
  .then(() => {
    console.log("Database connection established...");
    app.listen(process.env.PORT, () => {
      console.log(`server is successfully running on ${process.env.PORT}`);
    });
  })
  .catch((err) => {
    console.log("Database can't be connected!");
  });
