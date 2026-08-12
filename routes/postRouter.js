const express = require("express");
const postRouter = express.Router();
const { userAuth } = require("../middlewares/auth");
const Post = require("../models/Post");
const Follow = require("../models/Follow");
const Reaction = require("../models/Reaction");
const ConnectionRequest = require("../models/connectionRequest");

// CREATE a new post
postRouter.post("/post", userAuth, async (req, res) => {
  try {
    const { type, content, codeSnippet, forkedFrom, stackTags, visibility } = req.body;
    
    if (!content) {
      return res.status(400).json({ message: "Post content is required" });
    }

    if (type === "snippet" && (!codeSnippet || !codeSnippet.code)) {
      return res.status(400).json({ message: "Snippet posts must contain code" });
    }

    let rootPostId = null;
    if (forkedFrom) {
      const parentPost = await Post.findById(forkedFrom);
      if (!parentPost) return res.status(404).json({ message: "Parent post not found" });

      // Enforce visibility check before allowing fork
      if (parentPost.visibility === "followers") {
        // Must be a follower (or the author themselves)
        if (parentPost.authorId.toString() !== req.user._id.toString()) {
          const isFollower = await Follow.findOne({ followerId: req.user._id, targetId: parentPost.authorId });
          if (!isFollower) {
            return res.status(403).json({ message: "You are not allowed to view or fork this post" });
          }
        }
      } else if (parentPost.visibility === "matches") {
        // We will need to check ConnectionRequest status here (leaving a stub for now if it's strictly matches-only)
        if (parentPost.authorId.toString() !== req.user._id.toString()) {
          return res.status(403).json({ message: "Matches-only visibility check not fully implemented yet" });
        }
      }

      rootPostId = parentPost.rootPostId || parentPost._id;
    }

    const post = new Post({
      authorId: req.user._id,
      type: type || "standard",
      content,
      codeSnippet: type === "snippet" ? codeSnippet : undefined,
      forkedFrom,
      rootPostId,
      stackTags: stackTags || [],
      visibility: visibility || "public"
    });

    await post.save();
    await post.populate("authorId", "firstName lastName photoUrl skills");
    if (post.forkedFrom) {
      await post.populate({ path: "forkedFrom", populate: { path: "authorId", select: "firstName lastName" } });
    }

    res.status(201).json({
      message: "Post created successfully",
      data: post,
    });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// GET timeline feed (Followed + Global Trending combined)
postRouter.get("/feed/posts", userAuth, async (req, res) => {
  try {
    const userId = req.user._id;
    const page = parseInt(req.query.page) || 1;
    let limit = parseInt(req.query.limit) || 20;
    limit = limit > 50 ? 50 : limit;
    const skip = (page - 1) * limit;
    const filterTag = req.query.tag; // Tech stack filter

    // 1. Get followed users
    const follows = await Follow.find({ followerId: userId }).select("targetId");
    const followedUserIds = follows.map(f => f.targetId.toString());
    followedUserIds.push(userId.toString()); // Add self
    
    // 2. Get matched users
    const matches = await ConnectionRequest.find({
      status: "accepted",
      $or: [{ fromUserId: userId }, { toUserId: userId }]
    });
    const matchedUserIds = matches.map(m => 
      m.fromUserId.toString() === userId.toString() ? m.toUserId.toString() : m.fromUserId.toString()
    );

    // Build query
    const query = { moderationStatus: "safe" };
    
    // Visibility logic
    query.$or = [
      { visibility: "public" },
      { authorId: userId },
      { visibility: "followers", authorId: { $in: followedUserIds } },
      { visibility: "matches", authorId: { $in: matchedUserIds } }
    ];

    if (filterTag) {
      query.stackTags = filterTag.toLowerCase(); // Direct index hit, since tags are stored lowercase
    }

    // 2. Single Query (fixes pagination drift by treating followed & trending as one stream)
    const feed = await Post.find(query)
      .populate("authorId", "firstName lastName photoUrl skills")
      .populate({ path: "forkedFrom", populate: { path: "authorId", select: "firstName lastName" } })
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit);
      
    // Fetch user reactions for these posts
    const feedPostIds = feed.map(p => p._id);
    const userReactions = await Reaction.find({ userId, postId: { $in: feedPostIds } });
    const userReactionsMap = {};
    userReactions.forEach(r => {
      userReactionsMap[r.postId] = r.type;
    });

    res.status(200).json({ data: feed, followedUserIds, userReactionsMap });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// ATOMIC REACTION TOGGLE
postRouter.post("/post/:id/react", userAuth, async (req, res) => {
  try {
    const postId = req.params.id;
    const userId = req.user._id;
    const { type } = req.body; // 'fire', 'bug', 'clever', 'collab' (or 'none' to remove)

    const validTypes = ["fire", "bug", "clever", "collab", "none"];
    if (!validTypes.includes(type)) {
      return res.status(400).json({ message: "Invalid reaction type" });
    }

    const post = await Post.findById(postId);
    if (!post) return res.status(404).json({ message: "Post not found" });

    const existingReaction = await Reaction.findOne({ postId, userId });

    if (existingReaction) {
      if (existingReaction.type === type || type === "none") {
        // Same reaction or explicitly 'none' -> toggle off (unreact)
        await Reaction.findByIdAndDelete(existingReaction._id);
        await Post.findByIdAndUpdate(postId, { $inc: { [`reactions.${existingReaction.type}`]: -1 } });
        return res.json({ message: "Reaction removed", currentReaction: null });
      } else {
        // Change reaction
        const oldType = existingReaction.type;
        existingReaction.type = type;
        await existingReaction.save();
        await Post.findByIdAndUpdate(postId, { 
          $inc: { 
            [`reactions.${oldType}`]: -1,
            [`reactions.${type}`]: 1 
          } 
        });
        return res.json({ message: "Reaction updated", currentReaction: type });
      }
    } else {
      // New reaction
      if (type === "none") return res.status(400).json({ message: "Cannot apply 'none' to a non-existent reaction" });
      
      const reaction = new Reaction({ postId, userId, type });
      await reaction.save();
      await Post.findByIdAndUpdate(postId, { $inc: { [`reactions.${type}`]: 1 } });
      return res.json({ message: "Reaction added", currentReaction: type });
    }
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// DELETE a post
postRouter.delete("/post/:id", userAuth, async (req, res) => {
  try {
    const post = await Post.findById(req.params.id);
    if (!post) return res.status(404).json({ message: "Post not found" });
    
    if (post.authorId.toString() !== req.user._id.toString()) {
      return res.status(403).json({ message: "You can only delete your own posts" });
    }

    await post.deleteOne();
    // Cleanup reactions for this post
    await Reaction.deleteMany({ postId: post._id });

    res.status(200).json({ message: "Post deleted successfully", data: post._id });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

module.exports = postRouter;
