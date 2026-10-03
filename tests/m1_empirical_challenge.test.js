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

// Extract the route handler functions directly from Express routers
const pinRoute = postRouter.stack.find(
  (l) => l.route && l.route.path === "/post/:id/pin"
);
const pinHandler = pinRoute.route.stack[pinRoute.route.stack.length - 1].handle;

const profileRoute = publicRouter.stack.find(
  (l) => l.route && l.route.path === "/user/:userId"
);
const profileHandler =
  profileRoute.route.stack[profileRoute.route.stack.length - 1].handle;

// Helper to create mock response object
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

// Default mocks for secondary collections in profile endpoint
function setupDefaultProfileMocks() {
  Follow.exists = async () => false;
  Post.find = () => ({
    distinct: async () => [],
    sort: () => ({ limit: () => ({ lean: async () => [] }) }),
  });
  ConnectionRequestModel.countDocuments = async () => 0;
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

describe("Milestone 1 Empirical Verification: Connection Request States & connectionRequestId", () => {
  const loggedInUserId = new mongoose.Types.ObjectId();
  const targetUserId = new mongoose.Types.ObjectId();
  const reqId = new mongoose.Types.ObjectId();

  beforeEach(() => {
    setupDefaultProfileMocks();
  });

  it("1. State: 'none' when no connection request exists (connectionRequestId must be null)", async () => {
    User.findById = () => ({
      select: async () => ({ _id: targetUserId, helpfulAnswers: 5 }),
    });
    ConnectionRequestModel.findOne = async () => null;

    const req = {
      params: { userId: targetUserId.toString() },
      user: { _id: loggedInUserId },
    };
    const res = createMockRes();

    await profileHandler(req, res);

    assert.strictEqual(res.statusCode, 200);
    assert.strictEqual(res.body.connectionStatus, "none");
    assert.strictEqual(res.body.connectionRequestId, null);
  });

  it("2. State: 'pending' (outgoing) when status is 'interested' and sender is logged-in user", async () => {
    User.findById = () => ({
      select: async () => ({ _id: targetUserId, helpfulAnswers: 5 }),
    });
    ConnectionRequestModel.findOne = async () => ({
      _id: reqId,
      fromUserId: loggedInUserId,
      toUserId: targetUserId,
      status: "interested",
    });

    const req = {
      params: { userId: targetUserId.toString() },
      user: { _id: loggedInUserId },
    };
    const res = createMockRes();

    await profileHandler(req, res);

    assert.strictEqual(res.statusCode, 200);
    assert.strictEqual(res.body.connectionStatus, "pending");
    assert.ok(res.body.connectionRequestId);
    assert.strictEqual(res.body.connectionRequestId.toString(), reqId.toString());
  });

  it("3. State: 'received' (incoming) when status is 'interested' and sender is target user", async () => {
    User.findById = () => ({
      select: async () => ({ _id: targetUserId, helpfulAnswers: 5 }),
    });
    ConnectionRequestModel.findOne = async () => ({
      _id: reqId,
      fromUserId: targetUserId,
      toUserId: loggedInUserId,
      status: "interested",
    });

    const req = {
      params: { userId: targetUserId.toString() },
      user: { _id: loggedInUserId },
    };
    const res = createMockRes();

    await profileHandler(req, res);

    assert.strictEqual(res.statusCode, 200);
    assert.strictEqual(res.body.connectionStatus, "received");
    assert.ok(res.body.connectionRequestId);
    assert.strictEqual(res.body.connectionRequestId.toString(), reqId.toString());
  });

  it("4. State: 'accepted' when request is accepted (outgoing direction, connectionRequestId must be null)", async () => {
    User.findById = () => ({
      select: async () => ({ _id: targetUserId, helpfulAnswers: 5 }),
    });
    ConnectionRequestModel.findOne = async () => ({
      _id: reqId,
      fromUserId: loggedInUserId,
      toUserId: targetUserId,
      status: "accepted",
    });

    const req = {
      params: { userId: targetUserId.toString() },
      user: { _id: loggedInUserId },
    };
    const res = createMockRes();

    await profileHandler(req, res);

    assert.strictEqual(res.statusCode, 200);
    assert.strictEqual(res.body.connectionStatus, "accepted");
    assert.strictEqual(res.body.connectionRequestId, null);
  });

  it("5. State: 'accepted' when request is accepted (incoming direction, connectionRequestId must be null)", async () => {
    User.findById = () => ({
      select: async () => ({ _id: targetUserId, helpfulAnswers: 5 }),
    });
    ConnectionRequestModel.findOne = async () => ({
      _id: reqId,
      fromUserId: targetUserId,
      toUserId: loggedInUserId,
      status: "accepted",
    });

    const req = {
      params: { userId: targetUserId.toString() },
      user: { _id: loggedInUserId },
    };
    const res = createMockRes();

    await profileHandler(req, res);

    assert.strictEqual(res.statusCode, 200);
    assert.strictEqual(res.body.connectionStatus, "accepted");
    assert.strictEqual(res.body.connectionRequestId, null);
  });

  it("6. State: 'rejected' when request is rejected (connectionRequestId must be null)", async () => {
    User.findById = () => ({
      select: async () => ({ _id: targetUserId, helpfulAnswers: 5 }),
    });
    ConnectionRequestModel.findOne = async () => ({
      _id: reqId,
      fromUserId: loggedInUserId,
      toUserId: targetUserId,
      status: "rejected",
    });

    const req = {
      params: { userId: targetUserId.toString() },
      user: { _id: loggedInUserId },
    };
    const res = createMockRes();

    await profileHandler(req, res);

    assert.strictEqual(res.statusCode, 200);
    assert.strictEqual(res.body.connectionStatus, "rejected");
    assert.strictEqual(res.body.connectionRequestId, null);
  });

  it("7. Stress-test connection status matrix & connectionRequestId presence", async () => {
    const testCases = [
      { status: null, fromSelf: false, expectedStatus: "none", expectReqId: false },
      { status: "interested", fromSelf: true, expectedStatus: "pending", expectReqId: true },
      { status: "interested", fromSelf: false, expectedStatus: "received", expectReqId: true },
      { status: "accepted", fromSelf: true, expectedStatus: "accepted", expectReqId: false },
      { status: "accepted", fromSelf: false, expectedStatus: "accepted", expectReqId: false },
      { status: "rejected", fromSelf: true, expectedStatus: "rejected", expectReqId: false },
      { status: "rejected", fromSelf: false, expectedStatus: "rejected", expectReqId: false },
    ];

    for (const tc of testCases) {
      User.findById = () => ({
        select: async () => ({ _id: targetUserId, helpfulAnswers: 5 }),
      });
      if (tc.status === null) {
        ConnectionRequestModel.findOne = async () => null;
      } else {
        ConnectionRequestModel.findOne = async () => ({
          _id: reqId,
          fromUserId: tc.fromSelf ? loggedInUserId : targetUserId,
          toUserId: tc.fromSelf ? targetUserId : loggedInUserId,
          status: tc.status,
        });
      }

      const req = {
        params: { userId: targetUserId.toString() },
        user: { _id: loggedInUserId },
      };
      const res = createMockRes();

      await profileHandler(req, res);

      assert.strictEqual(
        res.body.connectionStatus,
        tc.expectedStatus,
        `Failed for status=${tc.status} fromSelf=${tc.fromSelf}`
      );
      if (tc.expectReqId) {
        assert.ok(
          res.body.connectionRequestId,
          `Expected connectionRequestId for status=${tc.status}`
        );
        assert.strictEqual(
          res.body.connectionRequestId.toString(),
          reqId.toString()
        );
      } else {
        assert.strictEqual(
          res.body.connectionRequestId,
          null,
          `Expected null connectionRequestId for status=${tc.status}`
        );
      }
    }
  });
});

describe("Milestone 1 Empirical Verification: Pinning Validation & Security Constraints", () => {
  const userId = new mongoose.Types.ObjectId();
  const otherUserId = new mongoose.Types.ObjectId();
  const postId = new mongoose.Types.ObjectId();

  it("1. Standard post pinning rejected with status 400", async () => {
    let saved = false;
    Post.findById = async () => ({
      _id: postId,
      authorId: userId,
      type: "standard",
      isPinnedToProfile: false,
      save: async () => {
        saved = true;
      },
    });

    const req = { params: { id: postId.toString() }, user: { _id: userId } };
    const res = createMockRes();

    await pinHandler(req, res);

    assert.strictEqual(res.statusCode, 400);
    assert.strictEqual(res.body.message, "Only snippet posts can be pinned");
    assert.strictEqual(saved, false);
  });

  it("2. Debug SOS post pinning rejected with status 400", async () => {
    let saved = false;
    Post.findById = async () => ({
      _id: postId,
      authorId: userId,
      type: "debug_sos",
      isPinnedToProfile: false,
      save: async () => {
        saved = true;
      },
    });

    const req = { params: { id: postId.toString() }, user: { _id: userId } };
    const res = createMockRes();

    await pinHandler(req, res);

    assert.strictEqual(res.statusCode, 400);
    assert.strictEqual(res.body.message, "Only snippet posts can be pinned");
    assert.strictEqual(saved, false);
  });

  it("3. Project post pinning rejected with status 400", async () => {
    let saved = false;
    Post.findById = async () => ({
      _id: postId,
      authorId: userId,
      type: "project",
      isPinnedToProfile: false,
      save: async () => {
        saved = true;
      },
    });

    const req = { params: { id: postId.toString() }, user: { _id: userId } };
    const res = createMockRes();

    await pinHandler(req, res);

    assert.strictEqual(res.statusCode, 400);
    assert.strictEqual(res.body.message, "Only snippet posts can be pinned");
    assert.strictEqual(saved, false);
  });

  it("4. Unknown / undefined post type rejected with status 400", async () => {
    let saved = false;
    Post.findById = async () => ({
      _id: postId,
      authorId: userId,
      type: "article",
      isPinnedToProfile: false,
      save: async () => {
        saved = true;
      },
    });

    const req = { params: { id: postId.toString() }, user: { _id: userId } };
    const res = createMockRes();

    await pinHandler(req, res);

    assert.strictEqual(res.statusCode, 400);
    assert.strictEqual(res.body.message, "Only snippet posts can be pinned");
    assert.strictEqual(saved, false);
  });

  it("5. Snippet post accepted when pinnedCount < 3 (count = 0)", async () => {
    let saved = false;
    const postObj = {
      _id: postId,
      authorId: userId,
      type: "snippet",
      isPinnedToProfile: false,
      save: async function () {
        saved = true;
      },
    };
    Post.findById = async () => postObj;
    Post.countDocuments = async () => 0;

    const req = { params: { id: postId.toString() }, user: { _id: userId } };
    const res = createMockRes();

    await pinHandler(req, res);

    assert.strictEqual(res.statusCode, 200);
    assert.strictEqual(res.body.isPinnedToProfile, true);
    assert.strictEqual(res.body.message, "Post pinned to profile");
    assert.strictEqual(saved, true);
    assert.strictEqual(postObj.isPinnedToProfile, true);
  });

  it("6. Snippet post accepted when pinnedCount = 1 and count = 2", async () => {
    for (const currentCount of [1, 2]) {
      let saved = false;
      const postObj = {
        _id: postId,
        authorId: userId,
        type: "snippet",
        isPinnedToProfile: false,
        save: async function () {
          saved = true;
        },
      };
      Post.findById = async () => postObj;
      Post.countDocuments = async () => currentCount;

      const req = { params: { id: postId.toString() }, user: { _id: userId } };
      const res = createMockRes();

      await pinHandler(req, res);

      assert.strictEqual(res.statusCode, 200);
      assert.strictEqual(res.body.isPinnedToProfile, true);
      assert.strictEqual(saved, true);
    }
  });

  it("7. Snippet post pinning REJECTED with 400 when pinnedCount = 3 (max 3 limit)", async () => {
    let saved = false;
    const postObj = {
      _id: postId,
      authorId: userId,
      type: "snippet",
      isPinnedToProfile: false,
      save: async function () {
        saved = true;
      },
    };
    Post.findById = async () => postObj;
    Post.countDocuments = async () => 3;

    const req = { params: { id: postId.toString() }, user: { _id: userId } };
    const res = createMockRes();

    await pinHandler(req, res);

    assert.strictEqual(res.statusCode, 400);
    assert.strictEqual(
      res.body.message,
      "You can pin a maximum of 3 posts to your profile"
    );
    assert.strictEqual(saved, false);
    assert.strictEqual(postObj.isPinnedToProfile, false);
  });

  it("8. Unpinning an already pinned snippet post SUCCEEDS even when pinnedCount >= 3", async () => {
    let saved = false;
    const postObj = {
      _id: postId,
      authorId: userId,
      type: "snippet",
      isPinnedToProfile: true, // Already pinned
      save: async function () {
        saved = true;
      },
    };
    Post.findById = async () => postObj;
    // countDocuments should not even block unpinning
    Post.countDocuments = async () => 3;

    const req = { params: { id: postId.toString() }, user: { _id: userId } };
    const res = createMockRes();

    await pinHandler(req, res);

    assert.strictEqual(res.statusCode, 200);
    assert.strictEqual(res.body.isPinnedToProfile, false);
    assert.strictEqual(res.body.message, "Post unpinned from profile");
    assert.strictEqual(saved, true);
    assert.strictEqual(postObj.isPinnedToProfile, false);
  });

  it("9. Security: Pinning another user's post rejected with status 403", async () => {
    let saved = false;
    const postObj = {
      _id: postId,
      authorId: otherUserId, // Different user
      type: "snippet",
      isPinnedToProfile: false,
      save: async function () {
        saved = true;
      },
    };
    Post.findById = async () => postObj;

    const req = { params: { id: postId.toString() }, user: { _id: userId } };
    const res = createMockRes();

    await pinHandler(req, res);

    assert.strictEqual(res.statusCode, 403);
    assert.strictEqual(res.body.message, "You can only pin your own posts");
    assert.strictEqual(saved, false);
  });

  it("10. Pinning non-existent post returns status 404", async () => {
    Post.findById = async () => null;

    const req = { params: { id: postId.toString() }, user: { _id: userId } };
    const res = createMockRes();

    await pinHandler(req, res);

    assert.strictEqual(res.statusCode, 404);
    assert.strictEqual(res.body.message, "Post not found");
  });
});

describe("Milestone 1 Empirical Verification: Responsiveness Threshold (9 vs 10 solves)", () => {
  const loggedInUserId = new mongoose.Types.ObjectId();
  const targetUserId = new mongoose.Types.ObjectId();

  beforeEach(() => {
    setupDefaultProfileMocks();
    ConnectionRequestModel.findOne = async () => null;
  });

  it("1. Exactly 9 solves -> isResponsive is false, totalSolved is 9", async () => {
    User.findById = () => ({
      select: async () => ({ _id: targetUserId, helpfulAnswers: 9 }),
    });

    const req = {
      params: { userId: targetUserId.toString() },
      user: { _id: loggedInUserId },
    };
    const res = createMockRes();

    await profileHandler(req, res);

    assert.strictEqual(res.statusCode, 200);
    assert.strictEqual(res.body.sosTrackRecord.totalSolved, 9);
    assert.strictEqual(res.body.sosTrackRecord.isResponsive, false);
  });

  it("2. Exactly 10 solves -> isResponsive is true, totalSolved is 10", async () => {
    User.findById = () => ({
      select: async () => ({ _id: targetUserId, helpfulAnswers: 10 }),
    });

    const req = {
      params: { userId: targetUserId.toString() },
      user: { _id: loggedInUserId },
    };
    const res = createMockRes();

    await profileHandler(req, res);

    assert.strictEqual(res.statusCode, 200);
    assert.strictEqual(res.body.sosTrackRecord.totalSolved, 10);
    assert.strictEqual(res.body.sosTrackRecord.isResponsive, true);
  });

  it("3. Stress-test responsiveness threshold boundaries across values [0, 1, 8, 9, 10, 11, null, undefined]", async () => {
    const matrix = [
      { input: 0, expectedSolved: 0, expectedResponsive: false },
      { input: 1, expectedSolved: 1, expectedResponsive: false },
      { input: 8, expectedSolved: 8, expectedResponsive: false },
      { input: 9, expectedSolved: 9, expectedResponsive: false },
      { input: 10, expectedSolved: 10, expectedResponsive: true },
      { input: 11, expectedSolved: 11, expectedResponsive: true },
      { input: 25, expectedSolved: 25, expectedResponsive: true },
      { input: null, expectedSolved: 0, expectedResponsive: false },
      { input: undefined, expectedSolved: 0, expectedResponsive: false },
    ];

    for (const testCase of matrix) {
      User.findById = () => ({
        select: async () => ({
          _id: targetUserId,
          helpfulAnswers: testCase.input,
        }),
      });

      const req = {
        params: { userId: targetUserId.toString() },
        user: { _id: loggedInUserId },
      };
      const res = createMockRes();

      await profileHandler(req, res);

      assert.strictEqual(
        res.body.sosTrackRecord.totalSolved,
        testCase.expectedSolved,
        `totalSolved mismatch for helpfulAnswers=${testCase.input}`
      );
      assert.strictEqual(
        res.body.sosTrackRecord.isResponsive,
        testCase.expectedResponsive,
        `isResponsive mismatch for helpfulAnswers=${testCase.input}`
      );
    }
  });
});

describe("Milestone 1 Empirical Verification: recentSolves postId contract & fallback snippet filter", () => {
  const loggedInUserId = new mongoose.Types.ObjectId();
  const targetUserId = new mongoose.Types.ObjectId();
  const solvedPostId = new mongoose.Types.ObjectId();

  beforeEach(() => {
    setupDefaultProfileMocks();
    ConnectionRequestModel.findOne = async () => null;
  });

  it("1. recentSolves properly includes postId._id", async () => {
    User.findById = () => ({
      select: async () => ({ _id: targetUserId, helpfulAnswers: 12 }),
    });

    Comment.find = () => ({
      populate: () => ({
        sort: () => ({
          lean: async () => [
            {
              postId: {
                _id: solvedPostId,
                content: "Debugging MongoDB aggregation pipeline issue",
                stackTags: ["mongodb", "nodejs"],
              },
              createdAt: new Date("2026-09-30T10:00:00Z"),
            },
          ],
        }),
      }),
    });

    const req = {
      params: { userId: targetUserId.toString() },
      user: { _id: loggedInUserId },
    };
    const res = createMockRes();

    await profileHandler(req, res);

    assert.strictEqual(res.statusCode, 200);
    const solves = res.body.sosTrackRecord.recentSolves;
    assert.strictEqual(solves.length, 1);
    assert.ok(solves[0].postId, "postId must be present in recentSolves");
    assert.strictEqual(solves[0].postId.toString(), solvedPostId.toString());
    assert.strictEqual(
      solves[0].postContent,
      "Debugging MongoDB aggregation pipeline issue"
    );
    assert.deepStrictEqual(solves[0].stackTags, ["mongodb", "nodejs"]);
  });

  it("2. Fallback query filters only type: snippet with non-empty code", async () => {
    User.findById = () => ({
      select: async () => ({ _id: targetUserId, helpfulAnswers: 2 }),
    });

    // Pinned count is 0, but postCount > 0, triggering fallback
    Post.countDocuments = async () => 5;
    Post.find = () => ({
      sort: () => ({ limit: () => ({ lean: async () => [] }) }),
      distinct: async () => [],
    });

    let aggregatePipeline = null;
    Post.aggregate = async (pipeline) => {
      aggregatePipeline = pipeline;
      return [
        {
          _id: new mongoose.Types.ObjectId(),
          type: "snippet",
          codeSnippet: { code: "console.log('hello')", language: "javascript" },
        },
      ];
    };

    const req = {
      params: { userId: targetUserId.toString() },
      user: { _id: loggedInUserId },
    };
    const res = createMockRes();

    await profileHandler(req, res);

    assert.strictEqual(res.statusCode, 200);
    assert.ok(aggregatePipeline, "Post.aggregate should have been called");
    const matchStage = aggregatePipeline.find((s) => s.$match)?.$match;
    assert.ok(matchStage, "$match stage must be present in fallback pipeline");
    assert.strictEqual(
      matchStage.type,
      "snippet",
      "Fallback query MUST require type: 'snippet'"
    );
    assert.deepStrictEqual(
      matchStage["codeSnippet.code"],
      { $exists: true, $nin: ["", null] },
      "Fallback query MUST require non-empty codeSnippet.code"
    );
  });
});

describe("Milestone 1 Empirical Verification: Full State Transition Lifecycles", () => {
  it("1. Dynamic Pinning Lifecycle (0 -> 1 -> 2 -> 3 -> 4th blocked -> unpin to 2 -> pin 4th -> unpin all)", async () => {
    const userId = new mongoose.Types.ObjectId();
    const posts = [
      { _id: new mongoose.Types.ObjectId(), authorId: userId, type: "snippet", isPinnedToProfile: false },
      { _id: new mongoose.Types.ObjectId(), authorId: userId, type: "snippet", isPinnedToProfile: false },
      { _id: new mongoose.Types.ObjectId(), authorId: userId, type: "snippet", isPinnedToProfile: false },
      { _id: new mongoose.Types.ObjectId(), authorId: userId, type: "snippet", isPinnedToProfile: false },
    ];

    // State tracker for pinned posts in database
    const pinnedState = new Map();
    posts.forEach((p) => {
      p.save = async function () {
        pinnedState.set(p._id.toString(), p.isPinnedToProfile);
      };
    });

    Post.countDocuments = async (query) => {
      let count = 0;
      for (const [id, isPinned] of pinnedState.entries()) {
        if (isPinned) count++;
      }
      return count;
    };

    Post.findById = async (id) => posts.find((p) => p._id.toString() === id.toString());

    // Step 1: Pin 1st snippet
    let res = createMockRes();
    await pinHandler({ params: { id: posts[0]._id.toString() }, user: { _id: userId } }, res);
    assert.strictEqual(res.statusCode, 200);
    assert.strictEqual(posts[0].isPinnedToProfile, true);
    assert.strictEqual(await Post.countDocuments(), 1);

    // Step 2: Pin 2nd snippet
    res = createMockRes();
    await pinHandler({ params: { id: posts[1]._id.toString() }, user: { _id: userId } }, res);
    assert.strictEqual(res.statusCode, 200);
    assert.strictEqual(posts[1].isPinnedToProfile, true);
    assert.strictEqual(await Post.countDocuments(), 2);

    // Step 3: Pin 3rd snippet (now at max limit)
    res = createMockRes();
    await pinHandler({ params: { id: posts[2]._id.toString() }, user: { _id: userId } }, res);
    assert.strictEqual(res.statusCode, 200);
    assert.strictEqual(posts[2].isPinnedToProfile, true);
    assert.strictEqual(await Post.countDocuments(), 3);

    // Step 4: Attempt to pin 4th snippet -> BLOCKED with 400
    res = createMockRes();
    await pinHandler({ params: { id: posts[3]._id.toString() }, user: { _id: userId } }, res);
    assert.strictEqual(res.statusCode, 400);
    assert.strictEqual(res.body.message, "You can pin a maximum of 3 posts to your profile");
    assert.strictEqual(posts[3].isPinnedToProfile, false);
    assert.strictEqual(await Post.countDocuments(), 3);

    // Step 5: Unpin 2nd snippet -> allowed
    res = createMockRes();
    await pinHandler({ params: { id: posts[1]._id.toString() }, user: { _id: userId } }, res);
    assert.strictEqual(res.statusCode, 200);
    assert.strictEqual(posts[1].isPinnedToProfile, false);
    assert.strictEqual(await Post.countDocuments(), 2);

    // Step 6: Now pin 4th snippet -> SUCCEEDS!
    res = createMockRes();
    await pinHandler({ params: { id: posts[3]._id.toString() }, user: { _id: userId } }, res);
    assert.strictEqual(res.statusCode, 200);
    assert.strictEqual(posts[3].isPinnedToProfile, true);
    assert.strictEqual(await Post.countDocuments(), 3);

    // Step 7: Unpin all remaining posts
    for (const p of [posts[0], posts[2], posts[3]]) {
      res = createMockRes();
      await pinHandler({ params: { id: p._id.toString() }, user: { _id: userId } }, res);
      assert.strictEqual(res.statusCode, 200);
      assert.strictEqual(p.isPinnedToProfile, false);
    }
    assert.strictEqual(await Post.countDocuments(), 0);
  });

  it("2. Dynamic Connection Request State Transitions (none -> pending/received -> accepted/rejected)", async () => {
    setupDefaultProfileMocks();

    const userAId = new mongoose.Types.ObjectId();
    const userBId = new mongoose.Types.ObjectId();
    const reqId = new mongoose.Types.ObjectId();

    User.findById = (id) => ({
      select: async () => ({ _id: id, helpfulAnswers: 15 }),
    });

    let currentRequest = null;
    ConnectionRequestModel.findOne = async () => currentRequest;

    // Stage 1: Initial state (none)
    let resA = createMockRes();
    await profileHandler({ params: { userId: userBId.toString() }, user: { _id: userAId } }, resA);
    assert.strictEqual(resA.body.connectionStatus, "none");
    assert.strictEqual(resA.body.connectionRequestId, null);

    let resB = createMockRes();
    await profileHandler({ params: { userId: userAId.toString() }, user: { _id: userBId } }, resB);
    assert.strictEqual(resB.body.connectionStatus, "none");
    assert.strictEqual(resB.body.connectionRequestId, null);

    // Stage 2: User A sends interested request to User B
    currentRequest = {
      _id: reqId,
      fromUserId: userAId,
      toUserId: userBId,
      status: "interested",
    };

    // From A's perspective -> pending (outgoing)
    resA = createMockRes();
    await profileHandler({ params: { userId: userBId.toString() }, user: { _id: userAId } }, resA);
    assert.strictEqual(resA.body.connectionStatus, "pending");
    assert.strictEqual(resA.body.connectionRequestId.toString(), reqId.toString());

    // From B's perspective -> received (incoming)
    resB = createMockRes();
    await profileHandler({ params: { userId: userAId.toString() }, user: { _id: userBId } }, resB);
    assert.strictEqual(resB.body.connectionStatus, "received");
    assert.strictEqual(resB.body.connectionRequestId.toString(), reqId.toString());

    // Stage 3a: Request is accepted
    currentRequest.status = "accepted";

    // From A's perspective -> accepted, reqId is null
    resA = createMockRes();
    await profileHandler({ params: { userId: userBId.toString() }, user: { _id: userAId } }, resA);
    assert.strictEqual(resA.body.connectionStatus, "accepted");
    assert.strictEqual(resA.body.connectionRequestId, null);

    // From B's perspective -> accepted, reqId is null
    resB = createMockRes();
    await profileHandler({ params: { userId: userAId.toString() }, user: { _id: userBId } }, resB);
    assert.strictEqual(resB.body.connectionStatus, "accepted");
    assert.strictEqual(resB.body.connectionRequestId, null);

    // Stage 3b: Request is rejected
    currentRequest.status = "rejected";

    // From A's perspective -> rejected, reqId is null
    resA = createMockRes();
    await profileHandler({ params: { userId: userBId.toString() }, user: { _id: userAId } }, resA);
    assert.strictEqual(resA.body.connectionStatus, "rejected");
    assert.strictEqual(resA.body.connectionRequestId, null);

    // From B's perspective -> rejected, reqId is null
    resB = createMockRes();
    await profileHandler({ params: { userId: userAId.toString() }, user: { _id: userBId } }, resB);
    assert.strictEqual(resB.body.connectionStatus, "rejected");
    assert.strictEqual(resB.body.connectionRequestId, null);
  });
});

describe("Milestone 1 Empirical Verification: Express Router Integration", () => {
  it("In-memory Express router delivers compliant JSON contract", async () => {
    setupDefaultProfileMocks();

    const loggedInUser = { _id: new mongoose.Types.ObjectId() };
    const targetUserId = new mongoose.Types.ObjectId();
    const reqId = new mongoose.Types.ObjectId();

    User.findById = () => ({
      select: async () => ({
        _id: targetUserId,
        firstName: "Test",
        lastName: "Developer",
        helpfulAnswers: 10,
      }),
    });

    ConnectionRequestModel.findOne = async () => ({
      _id: reqId,
      fromUserId: targetUserId,
      toUserId: loggedInUser._id,
      status: "interested",
    });

    const req = {
      method: "GET",
      url: `/user/${targetUserId}`,
      params: { userId: targetUserId.toString() },
      user: loggedInUser,
    };
    const res = createMockRes();

    await profileHandler(req, res);

    assert.strictEqual(res.statusCode, 200);
    assert.strictEqual(res.body.connectionStatus, "received");
    assert.strictEqual(res.body.connectionRequestId.toString(), reqId.toString());
    assert.strictEqual(res.body.sosTrackRecord.isResponsive, true);
    assert.strictEqual(res.body.sosTrackRecord.totalSolved, 10);
    assert.strictEqual(res.body.user.firstName, "Test");
  });
});


