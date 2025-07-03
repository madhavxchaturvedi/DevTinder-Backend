const express = require("express");
const connectDB = require("./config/database");
const User = require("./models/User");
const { validateSignUpData } = require("./utils/validation");
const bcrypt = require("bcrypt");
const app = express();

app.use(express.json());

app.post("/signup", async (req, res) => {
  try {
    //Validation of Data
    validateSignUpData(req);

    const { firstName, lastName, emailId, password } = req.body;

    //Encrypt the password
    const passwordHash = await bcrypt.hash(password, 10);
    console.log(passwordHash);

    const newUser = new User({
      firstName,
      lastName,
      emailId,
      password: passwordHash,
    });
    await newUser.save();
    res.send("User is sucssesfully signUp");
  } catch (err) {
    res.status(400).send("ERROR : " + err.message);
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
  const userId = req.body.userId;
  try {
    const user = await User.findByIdAndDelete(userId);
    res.send("User is successfull Deleted!");
  } catch (err) {
    res.status(401).send("Something went Wrong");
  }
});

app.patch("/user/:userId", async (req, res) => {
  const userId = req.params?.userId;
  const data = req.body;
  const ALLOWED_UPDATES = ["photoUrl", "about", "gender", "skills", "age"];

  try {
    const isUpdateAllowed = Object.keys(data).every((k) =>
      ALLOWED_UPDATES.includes(k)
    );

    if (!isUpdateAllowed) {
      throw new Error(" Update not Allowed!");
    }

    if (data?.skills.lenght > 10) {
      throw new Error("Skills can't be more then 10");
    }

    const user = await User.findByIdAndUpdate(userId, data, {
      runValidators: true,
    });
    res.send("user successfully Updated!");
  } catch (err) {
    res.status(400).send("Upadate Failed" + err.message);
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
