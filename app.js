const express = require("express");
const connectDB = require("./config/database");
const User = require("./models/User");
const app = express();

app.post("/signup", async (req, res) => {
  const userObj = {
    firstName: "Madhav",
    lastName: "Chaturvedi",
    emailId: "madhavchaturvedi0562@gmail.com",
    password: "madhav@1234",
  };

  const newUser = new User(userObj);

  try {
    await newUser.save();
    res.send("User is sucssesfully signUp");
  } catch (err) {
    res.status(400).send("Error Saving the User" + err.message);
  }
});

connectDB()
  .then(() => {
    console.log("Database connection established...");
    app.listen(8000, () => {
      console.log("server is sucessfully running on 8000");
    });
  })
  .catch((err) => {
    console.log("Database can't be connected!");
  });
