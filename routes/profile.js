const express = require("express");
const router = express.Router();
const multer = require("multer");
const { userAuth } = require("../middlewares/auth");
const { validateMyProfileEditData } = require("../utils/validation");
const cloudinary = require("../utils/cloudinary");
const streamifier = require("stream");

// Multer: store in memory, images only, max 5 MB
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 }, // 5 MB
  fileFilter(req, file, cb) {
    if (!file.mimetype.startsWith("image/")) {
      return cb(new Error("Only image files are allowed"), false);
    }
    cb(null, true);
  },
});

router.get("/profile/view", userAuth, async (req, res) => {
  try {
    const user = req.user;
    res.send(user);
  } catch (err) {
    res.status(400).send("ERROR : " + err.message);
  }
});

router.post("/profile/edit", userAuth, async (req, res) => {
  try {
    if (!validateMyProfileEditData(req)) {
      throw new Error("Invalid Edit Request!");
    }

    const loggedInUser = req.user;
    Object.keys(req.body).forEach((key) => (loggedInUser[key] = req.body[key]));

    await loggedInUser.save();

    res.json({
      message: `${loggedInUser.firstName}, your profile updated successfuly`,
      data: loggedInUser,
    });
  } catch (err) {
    res.status(400).send("ERROR : " + err.message);
  }
});

// POST /profile/upload-photo
// Accepts a multipart/form-data file under the field name "photo"
// Uploads to Cloudinary and updates the user's photoUrl in DB
router.post(
  "/profile/upload-photo",
  userAuth,
  upload.single("photo"),
  async (req, res) => {
    try {
      if (!req.file) {
        return res.status(400).json({ message: "No file uploaded" });
      }

      // Upload buffer to Cloudinary via upload_stream
      const uploadFromBuffer = () =>
        new Promise((resolve, reject) => {
          const uploadStream = cloudinary.uploader.upload_stream(
            {
              folder: "devtinder/profile-photos",
              transformation: [
                { width: 600, height: 600, crop: "fill", gravity: "face" },
                { quality: "auto", fetch_format: "auto" },
              ],
            },
            (error, result) => {
              if (error) return reject(error);
              resolve(result);
            }
          );

          // Pipe the buffer into the upload stream
          const bufferStream = new streamifier.Readable();
          bufferStream.push(req.file.buffer);
          bufferStream.push(null);
          bufferStream.pipe(uploadStream);
        });

      const result = await uploadFromBuffer();

      // Update user's photoUrl in DB
      const loggedInUser = req.user;
      loggedInUser.photoUrl = result.secure_url;
      await loggedInUser.save();

      res.json({
        message: "Photo uploaded successfully",
        photoUrl: result.secure_url,
      });
    } catch (err) {
      console.error("Upload error:", err);
      res.status(500).json({ message: err.message });
    }
  }
);

module.exports = router;
