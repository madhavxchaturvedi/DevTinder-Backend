const express = require("express");
const router = express.Router();
const { userAuth } = require("../middlewares/auth");
const User = require("../models/User");
const ConnectionRequestModel = require("../models/connectionRequest");
const Post = require("../models/Post");
const Reaction = require("../models/Reaction");
const Comment = require("../models/Comment");
const ProjectRoom = require("../models/ProjectRoom");
const Follow = require("../models/Follow");

const PUBLIC_FIELDS =
  "firstName lastName photoUrl skills age about gender " +
  "headline location coverPhoto twitterUrl portfolioUrl " +
  "followersCount followingCount helpfulAnswers openToPair lastSeen " +
  "isPremium";

// GET /user/:userId — Full public profile with aggregated data
router.get("/user/:userId", userAuth, async (req, res) => {
  try {
    const { userId } = req.params;
    const loggedInUserId = req.user._id;

    const targetUser = await User.findById(userId).select(PUBLIC_FIELDS);
    if (!targetUser) {
      return res.status(404).json({ message: "User not found", success: false });
    }

    // ── Connection status ──────────────────────────────────────
    const connectionRequest = await ConnectionRequestModel.findOne({
      $or: [
        { fromUserId: loggedInUserId, toUserId: userId },
        { fromUserId: userId, toUserId: loggedInUserId },
      ],
    });

    let connectionStatus = "none";
    let connectionRequestId = null;
    if (connectionRequest) {
      connectionStatus = connectionRequest.status;
      if (connectionRequest.status === "interested") {
        const isOutgoing =
          connectionRequest.fromUserId.toString() === loggedInUserId.toString();
        connectionStatus = isOutgoing ? "pending" : "received";
        connectionRequestId = connectionRequest._id;
      }
    }

    // ── Follow status ──────────────────────────────────────────
    const isFollowing = await Follow.exists({
      followerId: loggedInUserId,
      targetId: userId,
    });

    // ── Stats (parallel queries) ───────────────────────────────
    const userPostIds = await Post.find({ authorId: userId }).distinct("_id");
    let postCount = userPostIds.length;
    const [connectionCount, totalReactions] = await Promise.all([
      ConnectionRequestModel.countDocuments({
        $or: [
          { fromUserId: userId, status: "accepted" },
          { toUserId: userId, status: "accepted" },
        ],
      }),
      // Total reactions received across all posts by this user
      Reaction.countDocuments({
        postId: {
          $in: userPostIds,
        },
      }),
    ]);
    if (postCount === 0) {
      postCount = await Post.countDocuments({ authorId: userId });
    }

    // ── Pinned snippets (max 3), fallback to top-reacted posts ─
    let pinnedPosts = await Post.find({
      authorId: userId,
      isPinnedToProfile: true,
    })
      .sort({ createdAt: -1 })
      .limit(3)
      .lean();

    // Fallback: if nothing pinned, show top-reacted posts
    if (pinnedPosts.length === 0 && postCount > 0) {
      pinnedPosts = await Post.aggregate([
        {
          $match: {
            authorId: targetUser._id,
            type: "snippet",
            "codeSnippet.code": { $exists: true, $nin: ["", null] },
          },
        },
        {
          $addFields: {
            totalReactions: {
              $add: [
                { $ifNull: ["$reactions.fire", 0] },
                { $ifNull: ["$reactions.bug", 0] },
                { $ifNull: ["$reactions.clever", 0] },
                { $ifNull: ["$reactions.collab", 0] },
              ],
            },
          },
        },
        { $sort: { totalReactions: -1, createdAt: -1 } },
        { $limit: 3 },
      ]);
    }

    // ── Shipped Together (ProjectRoom history) ─────────────────
    const projectRooms = await ProjectRoom.find({
      members: userId,
    })
      .populate("members", "firstName lastName photoUrl")
      .populate("projectPostId", "project.title project.techStack")
      .sort({ updatedAt: -1 })
      .limit(6)
      .lean();

    const shippedTogether = projectRooms.map((room) => ({
      roomId: room.roomId,
      title: room.title || room.projectPostId?.project?.title || "Untitled Project",
      techStack: room.projectPostId?.project?.techStack || [],
      template: room.template,
      status: room.status,
      members: room.members.filter(
        (m) => m._id.toString() !== userId.toString()
      ),
      createdAt: room.createdAt,
      updatedAt: room.updatedAt,
    }));

    // ── Debug SOS Track Record ─────────────────────────────────
    // Find all SOS posts where this user's comment was the accepted answer
    const resolvedComments = await Comment.find({
      authorId: userId,
      isResolvedAnswer: true,
    })
      .populate({
        path: "postId",
        select: "_id content stackTags createdAt",
        match: { type: "debug_sos" },
      })
      .sort({ createdAt: -1 })
      .lean();

    const sosTrackRecord = {
      totalSolved: targetUser.helpfulAnswers || 0,
      // Compute responsiveness label from data
      isResponsive: (targetUser.helpfulAnswers || 0) >= 10,
      // Top areas from the SOS posts this user solved
      topAreas: [],
      recentSolves: [],
    };

    // Aggregate top areas from resolved SOS posts
    const areaCounts = {};
    resolvedComments.forEach((c) => {
      if (c.postId && c.postId.stackTags) {
        c.postId.stackTags.forEach((tag) => {
          areaCounts[tag] = (areaCounts[tag] || 0) + 1;
        });
      }
    });

    sosTrackRecord.topAreas = Object.entries(areaCounts)
      .sort(([, a], [, b]) => b - a)
      .slice(0, 5)
      .map(([tag, count]) => ({ tag, count }));

    const seenPostIds = new Set();
    sosTrackRecord.recentSolves = resolvedComments
      .filter((c) => c.postId)
      .filter((c) => {
        const pId = c.postId._id.toString();
        if (seenPostIds.has(pId)) return false;
        seenPostIds.add(pId);
        return true;
      })
      .slice(0, 3)
      .map((c) => ({
        postId: c.postId._id,
        postContent: c.postId.content?.slice(0, 100),
        stackTags: c.postId.stackTags,
        solvedAt: c.createdAt,
      }));

    res.json({
      user: targetUser,
      connectionStatus,
      connectionRequestId,
      isFollowing: !!isFollowing,
      stats: {
        connectionCount,
        totalReactions,
        postCount,
      },
      pinnedPosts,
      shippedTogether,
      sosTrackRecord,
    });
  } catch (err) {
    console.error("Profile fetch error:", err);
    res.status(500).json({ message: err.message, success: false });
  }
});

module.exports = router;
