const express = require("express");
const postRouter = express.Router();
const { userAuth } = require("../middlewares/auth");
const Post = require("../models/Post");
const User = require("../models/User");

// CREATE a new post
postRouter.post("/post", userAuth, async (req, res) => {
  try {
    const { content, codeSnippet, codeLanguage, imageUrl } = req.body;
    
    // Validate that either content or codeSnippet exists
    if (!content && !codeSnippet && !imageUrl) {
      return res.status(400).json({ message: "Post cannot be empty" });
    }

    const post = new Post({
      authorId: req.user._id,
      content,
      codeSnippet,
      codeLanguage,
      imageUrl,
    });

    await post.save();
    
    // Populate author info before returning
    await post.populate("authorId", "firstName lastName photoUrl skills");

    res.status(201).json({
      message: "Post created successfully",
      data: post,
    });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// GET timeline feed (latest posts)
postRouter.get("/feed/posts", userAuth, async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    let limit = parseInt(req.query.limit) || 20;
    limit = limit > 50 ? 50 : limit;
    const skip = (page - 1) * limit;

    // Fetch posts sorted by newest first
    const posts = await Post.find({})
      .populate("authorId", "firstName lastName photoUrl skills")
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit);

    res.status(200).json({
      data: posts,
    });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// DELETE a post
postRouter.delete("/post/:id", userAuth, async (req, res) => {
  try {
    const post = await Post.findById(req.params.id);
    if (!post) {
      return res.status(404).json({ message: "Post not found" });
    }
    
    // Check ownership
    if (post.authorId.toString() !== req.user._id.toString()) {
      return res.status(403).json({ message: "You can only delete your own posts" });
    }

    await post.deleteOne();
    res.status(200).json({ message: "Post deleted successfully", data: post._id });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// LIKE/UNLIKE a post
postRouter.post("/post/like/:id", userAuth, async (req, res) => {
  try {
    const post = await Post.findById(req.params.id);
    if (!post) {
      return res.status(404).json({ message: "Post not found" });
    }

    const userId = req.user._id;
    const isLiked = post.likes.includes(userId);

    if (isLiked) {
      // Unlike
      post.likes.pull(userId);
    } else {
      // Like
      post.likes.push(userId);
    }

    await post.save();
    res.status(200).json({ message: isLiked ? "Post unliked" : "Post liked", data: post });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

module.exports = postRouter;
