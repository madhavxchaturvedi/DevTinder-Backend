const express = require("express");
const connectDB = require("./config/database");
const cookieParser = require("cookie-parser");

const authRouter = require("./routes/auth");
const profileRouter = require("./routes/profile");
const requestRouter = require("./routes/request");

const app = express();

app.use(express.json());
app.use(cookieParser());

app.use("/", authRouter);
app.use("/", profileRouter);
app.use("/", requestRouter);

connectDB()
  .then(() => {
    console.log("Database connection established...");
    app.listen(8000, () => {
      console.log("server is successfully running on 8000");
    });
  })
  .catch((err) => {
    console.log("Database can't be connected!");
  });
