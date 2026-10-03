const { describe, it, beforeEach } = require("node:test");
const assert = require("node:assert");
const mongoose = require("mongoose");

const postRouter = require("../routes/postRouter");
const publicRouter = require("../routes/publicProfile");

const Post = require("../models/Post");
const User = require("../models/User");
const ConnectionRequestModel = require("../models/connectionRequest");
const Comment = require("../models/Comment");
const Reaction = require("../models/Reaction");
const Follow = require("../models/Follow");
const ProjectRoom = require("../models/ProjectRoom");

const pinRoute = postRouter.stack.find(
  (l) => l.route && l.route.path === "/post/:id/pin"
);
const pinHandler = pinRoute.route.stack[pinRoute.route.stack.length - 1].handle;

const profileRoute = publicRouter.stack.find(
  (l) => l.route && l.route.path === "/user/:userId"
);
const profileHandler =
  profileRoute.route.stack[profileRoute.route.stack.length - 1].handle;

function createMockRes() {
  const res = {
    statusCode: 200,
    body: null,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(data) {
      this.body = data;
      return this;
    },
    send(data) {
      this.body = data;
      return this;
    },
  };
  return res;
}

function setupDefaultMocks() {
  Follow.exists = async () => false;
  Post.find = () => ({
    distinct: async () => [],
    sort: () => ({ limit: () => ({ lean: async () => [] }) }),
  });
  Post.aggregate = async () => [];
  ConnectionRequestModel.countDocuments = async () => 0;
  ConnectionRequestModel.findOne = async () => null;
  Reaction.countDocuments = async () => 0;
  Post.countDocuments = async () => 0;
  ProjectRoom.find = () => ({
    populate: () => ({
      populate: () => ({
        sort: () => ({ limit: () => ({ lean: async () => [] }) }),
      }),
    }),
  });
  Comment.find = () => ({
    populate: () => ({
      sort: () => ({ lean: async () => [] }),
    }),
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// CHALLENGE 1: Legacy Pinned Non-Snippet Posts & Pinning State Machine
// ─────────────────────────────────────────────────────────────────────────────
describe("Challenger Iteration 2: Legacy Pinned Non-Snippet Posts & Pinning State Machine", () => {
  const userId = new mongoose.Types.ObjectId();
  const otherUserId = new mongoose.Types.ObjectId();

  const nonSnippetTypes = ["standard", "debug_sos", "project", "article", undefined, null];

  for (const postType of nonSnippetTypes) {
    it(`1. Unpinning an already pinned non-snippet post (${postType}) SUCCEEDS with HTTP 200`, async () => {
      const postId = new mongoose.Types.ObjectId();
      let saved = false;
      const post = {
        _id: postId,
        authorId: userId,
        type: postType,
        isPinnedToProfile: true, // Legacy pinned state
        save: async () => { saved = true; },
      };

      Post.findById = async (id) => (id.toString() === postId.toString() ? post : null);
      let countCalled = false;
      Post.countDocuments = async () => { countCalled = true; return 5; };

      const req = {
        params: { id: postId.toString() },
        user: { _id: userId },
      };
      const res = createMockRes();

      await pinHandler(req, res);

      assert.strictEqual(res.statusCode, 200, `Expected 200 on unpinning post of type ${postType}`);
      assert.strictEqual(res.body.message, "Post unpinned from profile");
      assert.strictEqual(res.body.isPinnedToProfile, false);
      assert.strictEqual(saved, true, "post.save() must be invoked");
      assert.strictEqual(countCalled, false, "Post count check must be bypassed when unpinning");
    });

    it(`2. Newly pinning an unpinned non-snippet post (${postType}) FAILS with HTTP 400`, async () => {
      const postId = new mongoose.Types.ObjectId();
      let saved = false;
      const post = {
        _id: postId,
        authorId: userId,
        type: postType,
        isPinnedToProfile: false, // Unpinned
        save: async () => { saved = true; },
      };

      Post.findById = async (id) => (id.toString() === postId.toString() ? post : null);

      const req = {
        params: { id: postId.toString() },
        user: { _id: userId },
      };
      const res = createMockRes();

      await pinHandler(req, res);

      assert.strictEqual(res.statusCode, 400, `Expected 400 on newly pinning post of type ${postType}`);
      assert.strictEqual(res.body.message, "Only snippet posts can be pinned");
      assert.strictEqual(saved, false, "post.save() must NOT be called on rejected pinning");
      assert.strictEqual(post.isPinnedToProfile, false, "post.isPinnedToProfile must remain false");
    });
  }

  it("3. Unpinning an already pinned post succeeds even if user already has >= 3 pinned posts", async () => {
    const postId = new mongoose.Types.ObjectId();
    let saved = false;
    const post = {
      _id: postId,
      authorId: userId,
      type: "snippet",
      isPinnedToProfile: true,
      save: async () => { saved = true; },
    };

    Post.findById = async () => post;
    Post.countDocuments = async () => 3; // Already at maximum!

    const req = {
      params: { id: postId.toString() },
      user: { _id: userId },
    };
    const res = createMockRes();

    await pinHandler(req, res);

    assert.strictEqual(res.statusCode, 200);
    assert.strictEqual(res.body.message, "Post unpinned from profile");
    assert.strictEqual(res.body.isPinnedToProfile, false);
    assert.strictEqual(saved, true);
  });

  it("4. Newly pinning snippet post respects max 3 boundary (pinnedCount = 2 passes, 3 fails)", async () => {
    const postId = new mongoose.Types.ObjectId();
    const post = {
      _id: postId,
      authorId: userId,
      type: "snippet",
      isPinnedToProfile: false,
      save: async () => {},
    };

    Post.findById = async () => post;

    // Case A: pinnedCount = 2 -> Should pass
    Post.countDocuments = async () => 2;
    let req = { params: { id: postId.toString() }, user: { _id: userId } };
    let res = createMockRes();
    await pinHandler(req, res);
    assert.strictEqual(res.statusCode, 200);
    assert.strictEqual(res.body.isPinnedToProfile, true);

    // Case B: pinnedCount = 3 -> Should fail
    post.isPinnedToProfile = false;
    Post.countDocuments = async () => 3;
    req = { params: { id: postId.toString() }, user: { _id: userId } };
    res = createMockRes();
    await pinHandler(req, res);
    assert.strictEqual(res.statusCode, 400);
    assert.strictEqual(res.body.message, "You can pin a maximum of 3 posts to your profile");
    assert.strictEqual(post.isPinnedToProfile, false);
  });

  it("5. Authorization check: Pinning/unpinning another user's post returns 403 Forbidden", async () => {
    const postId = new mongoose.Types.ObjectId();
    const post = {
      _id: postId,
      authorId: otherUserId, // Different user
      type: "snippet",
      isPinnedToProfile: false,
      save: async () => {},
    };
    Post.findById = async () => post;

    const req = { params: { id: postId.toString() }, user: { _id: userId } };
    const res = createMockRes();
    await pinHandler(req, res);
    assert.strictEqual(res.statusCode, 403);
    assert.strictEqual(res.body.message, "You can only pin your own posts");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// CHALLENGE 2: Duplicate Comments on Same Post in recentSolves
// ─────────────────────────────────────────────────────────────────────────────
describe("Challenger Iteration 2: Duplicate Comments on Same Post in recentSolves", () => {
  const loggedInUserId = new mongoose.Types.ObjectId();
  const targetUserId = new mongoose.Types.ObjectId();

  beforeEach(() => {
    setupDefaultMocks();
  });

  it("1. Multiple comments across overlapping posts [A, B, A, C, D] results in distinct [A, B, C] capped at 3", async () => {
    const postA = { _id: new mongoose.Types.ObjectId(), content: "Post A problem", stackTags: ["node", "express"] };
    const postB = { _id: new mongoose.Types.ObjectId(), content: "Post B problem", stackTags: ["react"] };
    const postC = { _id: new mongoose.Types.ObjectId(), content: "Post C problem", stackTags: ["mongodb"] };
    const postD = { _id: new mongoose.Types.ObjectId(), content: "Post D problem", stackTags: ["redis"] };

    User.findById = () => ({
      select: async () => ({ _id: targetUserId, helpfulAnswers: 15 }),
    });

    Comment.find = () => ({
      populate: () => ({
        sort: () => ({
          lean: async () => [
            { _id: new mongoose.Types.ObjectId(), authorId: targetUserId, postId: postA, createdAt: new Date("2026-09-30T10:00:00Z") },
            { _id: new mongoose.Types.ObjectId(), authorId: targetUserId, postId: postB, createdAt: new Date("2026-09-30T09:00:00Z") },
            { _id: new mongoose.Types.ObjectId(), authorId: targetUserId, postId: postA, createdAt: new Date("2026-09-30T08:00:00Z") }, // DUPLICATE post A
            { _id: new mongoose.Types.ObjectId(), authorId: targetUserId, postId: postC, createdAt: new Date("2026-09-30T07:00:00Z") },
            { _id: new mongoose.Types.ObjectId(), authorId: targetUserId, postId: postD, createdAt: new Date("2026-09-30T06:00:00Z") },
          ],
        }),
      }),
    });

    const req = { params: { userId: targetUserId.toString() }, user: { _id: loggedInUserId } };
    const res = createMockRes();

    await profileHandler(req, res);

    assert.strictEqual(res.statusCode, 200);
    const { recentSolves } = res.body.sosTrackRecord;

    // Must have exactly 3 solves
    assert.strictEqual(recentSolves.length, 3, "recentSolves must be capped at 3 distinct entries");
    // Distinct check
    const solvePostIds = recentSolves.map((s) => s.postId.toString());
    assert.deepStrictEqual(solvePostIds, [postA._id.toString(), postB._id.toString(), postC._id.toString()]);
    // Post D should not be included (since top 3 distinct are A, B, C)
    assert.ok(!solvePostIds.includes(postD._id.toString()));
  });

  it("2. Ten comments all pointing to the SAME post results in exactly 1 distinct solve card", async () => {
    const commonPost = { _id: new mongoose.Types.ObjectId(), content: "Single heavy thread", stackTags: ["aws"] };

    User.findById = () => ({
      select: async () => ({ _id: targetUserId, helpfulAnswers: 10 }),
    });

    const tenComments = Array.from({ length: 10 }, (_, i) => ({
      _id: new mongoose.Types.ObjectId(),
      authorId: targetUserId,
      postId: commonPost,
      createdAt: new Date(Date.now() - i * 1000),
    }));

    Comment.find = () => ({
      populate: () => ({
        sort: () => ({
          lean: async () => tenComments,
        }),
      }),
    });

    const req = { params: { userId: targetUserId.toString() }, user: { _id: loggedInUserId } };
    const res = createMockRes();

    await profileHandler(req, res);

    assert.strictEqual(res.statusCode, 200);
    const { recentSolves } = res.body.sosTrackRecord;
    assert.strictEqual(recentSolves.length, 1, "Expected exactly 1 distinct solve entry despite 10 comments");
    assert.strictEqual(recentSolves[0].postId.toString(), commonPost._id.toString());
    assert.strictEqual(recentSolves[0].postContent, "Single heavy thread");
  });

  it("3. Interleaved deleted posts (postId: null) do not contaminate deduplication or throw", async () => {
    const postX = { _id: new mongoose.Types.ObjectId(), content: "Post X", stackTags: ["css"] };
    const postY = { _id: new mongoose.Types.ObjectId(), content: "Post Y", stackTags: ["html"] };

    User.findById = () => ({
      select: async () => ({ _id: targetUserId, helpfulAnswers: 4 }),
    });

    Comment.find = () => ({
      populate: () => ({
        sort: () => ({
          lean: async () => [
            { _id: new mongoose.Types.ObjectId(), postId: null, createdAt: new Date() },
            { _id: new mongoose.Types.ObjectId(), postId: postX, createdAt: new Date() },
            { _id: new mongoose.Types.ObjectId(), postId: null, createdAt: new Date() },
            { _id: new mongoose.Types.ObjectId(), postId: postX, createdAt: new Date() }, // duplicate X
            { _id: new mongoose.Types.ObjectId(), postId: postY, createdAt: new Date() },
            { _id: new mongoose.Types.ObjectId(), postId: null, createdAt: new Date() },
          ],
        }),
      }),
    });

    const req = { params: { userId: targetUserId.toString() }, user: { _id: loggedInUserId } };
    const res = createMockRes();

    await profileHandler(req, res);

    assert.strictEqual(res.statusCode, 200);
    const { recentSolves } = res.body.sosTrackRecord;
    assert.strictEqual(recentSolves.length, 2);
    assert.strictEqual(recentSolves[0].postId.toString(), postX._id.toString());
    assert.strictEqual(recentSolves[1].postId.toString(), postY._id.toString());
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// CHALLENGE 3: Post Count Query Optimization & Accuracy
// ─────────────────────────────────────────────────────────────────────────────
describe("Challenger Iteration 2: Post Count Query Optimization & Accuracy", () => {
  const loggedInUserId = new mongoose.Types.ObjectId();
  const targetUserId = new mongoose.Types.ObjectId();

  beforeEach(() => {
    setupDefaultMocks();
  });

  it("1. When user has posts (length > 0): Post.countDocuments is NOT called redundantly", async () => {
    const postIds = [
      new mongoose.Types.ObjectId(),
      new mongoose.Types.ObjectId(),
      new mongoose.Types.ObjectId(),
      new mongoose.Types.ObjectId(),
    ];

    User.findById = () => ({
      select: async () => ({ _id: targetUserId, helpfulAnswers: 3 }),
    });

    Post.find = (filter) => {
      if (filter && filter.isPinnedToProfile) {
        return { sort: () => ({ limit: () => ({ lean: async () => [] }) }) };
      }
      return {
        distinct: async (field) => {
          assert.strictEqual(field, "_id");
          return postIds;
        },
      };
    };

    let countDocumentsCalled = false;
    Post.countDocuments = async () => {
      countDocumentsCalled = true;
      return postIds.length;
    };

    Reaction.countDocuments = async (filter) => {
      assert.deepStrictEqual(filter.postId.$in, postIds);
      return 15;
    };

    ConnectionRequestModel.countDocuments = async () => 2;

    const req = { params: { userId: targetUserId.toString() }, user: { _id: loggedInUserId } };
    const res = createMockRes();

    await profileHandler(req, res);

    assert.strictEqual(res.statusCode, 200);
    assert.strictEqual(res.body.stats.postCount, 4);
    assert.strictEqual(countDocumentsCalled, false, "Post.countDocuments should NOT be called when postCount > 0 from userPostIds.length");
    assert.strictEqual(res.body.stats.totalReactions, 15);
    assert.strictEqual(res.body.stats.connectionCount, 2);
  });

  it("2. When user has 0 posts: stats.postCount is 0 and fallback aggregation is skipped", async () => {
    User.findById = () => ({
      select: async () => ({ _id: targetUserId, helpfulAnswers: 0 }),
    });

    Post.find = (filter) => {
      if (filter && filter.isPinnedToProfile) {
        return { sort: () => ({ limit: () => ({ lean: async () => [] }) }), distinct: async () => [] };
      }
      return { distinct: async () => [] };
    };

    let aggregateRan = false;
    Post.aggregate = async () => {
      aggregateRan = true;
      return [];
    };

    Post.countDocuments = async () => 0;

    const req = { params: { userId: targetUserId.toString() }, user: { _id: loggedInUserId } };
    const res = createMockRes();

    await profileHandler(req, res);

    assert.strictEqual(res.statusCode, 200);
    assert.strictEqual(res.body.stats.postCount, 0);
    assert.strictEqual(aggregateRan, false, "Fallback aggregate should NOT run when postCount is 0");
    assert.deepStrictEqual(res.body.pinnedPosts, []);
  });

  it("3. Verification of Promise.all concurrency batch contents: exactly 2 queries", async () => {
    const postIds = [new mongoose.Types.ObjectId()];
    User.findById = () => ({
      select: async () => ({ _id: targetUserId, helpfulAnswers: 1 }),
    });

    Post.find = (filter) => {
      if (filter && filter.isPinnedToProfile) {
        return { sort: () => ({ limit: () => ({ lean: async () => [] }) }) };
      }
      return { distinct: async () => postIds };
    };

    let parallelQueries = 0;
    const tStart = Date.now();
    ConnectionRequestModel.countDocuments = async () => {
      parallelQueries++;
      await new Promise((r) => setTimeout(r, 20));
      return 1;
    };
    Reaction.countDocuments = async () => {
      parallelQueries++;
      await new Promise((r) => setTimeout(r, 20));
      return 5;
    };

    const req = { params: { userId: targetUserId.toString() }, user: { _id: loggedInUserId } };
    const res = createMockRes();

    await profileHandler(req, res);

    assert.strictEqual(res.statusCode, 200);
    assert.strictEqual(parallelQueries, 2, "Only 2 queries (connections and reactions) should run inside Promise.all");
  });
});
