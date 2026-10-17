const express = require("express");
const rateLimit = require("express-rate-limit");
const Post = require("../models/Post");
const User = require("../models/User");
const ProjectRoom = require("../models/ProjectRoom");

const router = express.Router();

const TEST_EMAIL_REGEX = /@(test\.com|example\.com|devtinder\.io)$/i;
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

const cache = new Map();

const getFromCache = (key) => {
  const item = cache.get(key);
  if (!item) return null;
  if (Date.now() > item.expiresAt) {
    cache.delete(key);
    return null;
  }
  return item.data;
};

const setInCache = (key, data) => {
  cache.set(key, {
    data,
    expiresAt: Date.now() + CACHE_TTL_MS,
  });
};

const clearPublicCache = () => {
  cache.clear();
};

const publicLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100, // Limit each IP to 100 requests per 15-minute window
  standardHeaders: true,
  legacyHeaders: false,
  statusCode: 429,
  handler: (req, res, next, options) => {
    res.status(options.statusCode || 429).json({
      message: "Too many requests from this IP, please try again later.",
      success: false,
    });
  },
  validate: {
    trustProxy: false,
    xForwardedForHeader: false,
  },
});

router.use(publicLimiter);

// GET /public/showcase
router.get("/showcase", async (req, res) => {
  try {
    const cached = getFromCache("public_showcase");
    if (cached) {
      res.set("Cache-Control", "public, max-age=300");
      return res.json({
        success: true,
        data: cached,
      });
    }

    let query = Post.find({
      type: "project",
      visibility: "public",
      "project.isOpen": true,
      moderationStatus: "safe",
    });

    if (query && typeof query.sort === "function") {
      query = query.sort({ createdAt: -1 });
    }
    if (query && typeof query.limit === "function") {
      query = query.limit(50);
    }
    if (query && typeof query.populate === "function") {
      query = query.populate("authorId", "firstName photoUrl emailId isTest");
    }

    const candidatePosts = (await query) || [];

    const showcase = [];
    for (const post of candidatePosts) {
      const author = post.authorId;
      if (!author || typeof author !== "object") continue;
      if (author.isTest === true) continue;
      if (author.emailId && TEST_EMAIL_REGEX.test(author.emailId)) continue;

      showcase.push({
        _id: post._id,
        title: post.project?.title || "",
        techStack: Array.isArray(post.project?.techStack) ? post.project.techStack : [],
        roleNeeded: post.project?.roleNeeded || "",
        stage: post.project?.stage || "idea",
        commitment: post.project?.commitment || "ongoing",
        author: {
          firstName: author.firstName || "Developer",
          photoUrl: author.photoUrl || "",
        },
        createdAt: post.createdAt,
      });

      if (showcase.length >= 6) {
        break;
      }
    }

    setInCache("public_showcase", showcase);

    res.set("Cache-Control", "public, max-age=300");
    return res.json({
      success: true,
      data: showcase,
    });
  } catch (err) {
    res.status(500).json({
      message: err.message,
      success: false,
    });
  }
});

// GET /public/stats
router.get("/stats", async (req, res) => {
  try {
    const cached = getFromCache("public_stats");
    if (cached) {
      res.set("Cache-Control", "public, max-age=300");
      return res.json({
        success: true,
        data: cached,
        ...cached,
      });
    }

    const [developers, openProjects, completedRooms] = await Promise.all([
      User.countDocuments({
        emailId: { $not: TEST_EMAIL_REGEX },
        isTest: { $ne: true },
      }),
      Post.countDocuments({
        type: "project",
        "project.isOpen": true,
        visibility: "public",
        moderationStatus: "safe",
      }),
      ProjectRoom.countDocuments({
        status: "completed",
      }),
    ]);

    const statsData = {
      developers,
      openProjects,
      completedRooms,
    };

    setInCache("public_stats", statsData);

    res.set("Cache-Control", "public, max-age=300");
    return res.json({
      success: true,
      data: statsData,
      ...statsData,
    });
  } catch (err) {
    res.status(500).json({
      message: err.message,
      success: false,
    });
  }
});

router.clearPublicCache = clearPublicCache;
router.publicLimiter = publicLimiter;
router._cache = cache;

module.exports = router;
module.exports.clearPublicCache = clearPublicCache;
module.exports.publicLimiter = publicLimiter;
