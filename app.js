const express = require("express");
const connectDB = require("./config/database");
const User = require("./models/User");
const app = express();

app.use(express.json());

app.post("/signup", async (req, res) => {
  const newUser = new User(req.body);

  try {
    await newUser.save();
    res.send("User is sucssesfully signUp");
  } catch (err) {
    res.status(400).send("Error Saving the User" + err.message);
  }
});

// Feed API - get all the users
app.get("/feed", async (req, res) => {
  try {
    const users = await User.find({});
    if (users.length === 0) {
      res.send("No users Found!!");
    } else {
      res.send(users);
    }
  } catch (err) {
    res.status(401).send("Something went Wrong");
  }
});

app.delete("/user", async (req, res) => {
  try {
    const userId = req.body.userId;
    const user = await User.findByIdAndDelete(userId);
    res.send("User is successfull Deleted!");
  } catch (err) {
    res.status(401).send("Something went Wrong");
  }
});

app.patch("/user", async (req, res) => {
  try {
    const userId = req.body.userId;
    const data = req.body;
    const user = await User.findByIdAndUpdate(userId, data,{runValidators: true});
    res.send("user successfully Updated!");
  } catch (err) {
    res.status(400).send("Upadate Failed"+err.message);
  }
});

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
