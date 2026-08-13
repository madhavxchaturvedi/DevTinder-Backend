const express = require("express");
const commentRouter = express.Router();
const { userAuth } = require("../middlewares/auth");
const Post = require("../models/Post");
const Comment = require("../models/Comment");
const Follow = require("../models/Follow");
const ConnectionRequest = require("../models/connectionRequest");
const Notification = require("../models/Notification");
const User = require("../models/User");

// Helper function to check visibility
const checkPostVisibility = async (post, userId) => {
  if (post.authorId.toString() === userId.toString()) return true;
  if (post.visibility === "public") return true;

  if (post.visibility === "followers") {
    const isFollower = await Follow.findOne({ followerId: userId, targetId: post.authorId });
    return !!isFollower;
  }

  if (post.visibility === "matches") {
    const isMatch = await ConnectionRequest.findOne({
      status: "accepted",
      $or: [
        { fromUserId: userId, toUserId: post.authorId },
        { fromUserId: post.authorId, toUserId: userId }
      ]
    });
    return !!isMatch;
  }

  return false;
};

// GET comments for a post
commentRouter.get("/post/:id/comments", userAuth, async (req, res) => {
  try {
    const postId = req.params.id;
    const post = await Post.findById(postId);
    if (!post) return res.status(404).json({ message: "Post not found" });

    const isVisible = await checkPostVisibility(post, req.user._id);
    if (!isVisible) {
      return res.status(403).json({ message: "You don't have permission to view this post" });
    }

    const comments = await Comment.find({ postId })
      .populate("authorId", "firstName lastName photoUrl")
      .sort({ createdAt: 1 });

    res.json({ comments });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// POST a comment
commentRouter.post("/post/:id/comment", userAuth, async (req, res) => {
  try {
    const postId = req.params.id;
    const { text } = req.body;
    if (!text || !text.trim()) return res.status(400).json({ message: "Comment text is required" });

    const post = await Post.findById(postId);
    if (!post) return res.status(404).json({ message: "Post not found" });

    const isVisible = await checkPostVisibility(post, req.user._id);
    if (!isVisible) {
      return res.status(403).json({ message: "You don't have permission to comment on this post" });
    }

    const comment = new Comment({
      postId,
      authorId: req.user._id,
      text: text.trim(),
    });
    await comment.save();
    
    const populatedComment = await comment.populate("authorId", "firstName lastName photoUrl");

    // Notification Logic (1-to-1 for comments, no batching needed since each comment is distinct)
    if (post.authorId.toString() !== req.user._id.toString()) {
      const notification = await Notification.create({
        userId: post.authorId,
        actorIds: [req.user._id],
        type: "comment",
        postId: post._id,
        commentId: comment._id
      });
      const populatedNotification = await notification.populate("actorIds", "firstName lastName photoUrl");
      
      const io = req.app.get("io");
      if (io) {
        io.to(`user:${post.authorId}`).emit("newNotification", populatedNotification);
      }
    }

    res.status(201).json({ message: "Comment added", data: populatedComment });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// PATCH resolve comment
commentRouter.patch("/comment/:id/resolve", userAuth, async (req, res) => {
  try {
    const commentId = req.params.id;
    const comment = await Comment.findById(commentId).populate("postId");
    if (!comment) return res.status(404).json({ message: "Comment not found" });

    const post = comment.postId;
    if (!post) return res.status(404).json({ message: "Post not found" });

    // Enforce Debug SOS type
    if (post.type !== "debug_sos") {
      return res.status(400).json({ message: "Only Debug SOS posts can have resolved answers" });
    }

    // Enforce Authorization: only post author can mark as resolved
    if (post.authorId.toString() !== req.user._id.toString()) {
      return res.status(403).json({ message: "Only the author of the SOS post can mark an answer as resolved" });
    }

    // You can't resolve your own comment to game the system
    if (comment.authorId.toString() === req.user._id.toString()) {
      return res.status(400).json({ message: "You cannot mark your own comment as the resolved answer" });
    }

    if (comment.isResolvedAnswer) {
      return res.status(400).json({ message: "This comment is already marked as resolved" });
    }

    if (post.isResolved) {
      return res.status(400).json({ message: "This post has already been resolved" });
    }

    comment.isResolvedAnswer = true;
    await comment.save();

    post.isResolved = true;
    await post.save();

    // Increment helpfulAnswers on the comment author's profile
    await User.findByIdAndUpdate(comment.authorId, { $inc: { helpfulAnswers: 1 } });

    res.json({ message: "Answer marked as resolved", data: comment });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

module.exports = commentRouter;
