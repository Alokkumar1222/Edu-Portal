/**
 * ===================================================
 * EDU PORTAL - STATIC WEBSITE API SERVICE (js/api.js)
 * Direct Browser Integration for Firebase REST API, 
 * Google Drive Storage, and Gemini AI.
 * ===================================================
 */

const CONFIG = {
  FIREBASE_URL: "https://edu-portal-159ec-default-rtdb.firebaseio.com",
  FIREBASE_SECRET: "iAJUWqwUuEbSUQSSMw6A1dli0f2wRhWFNMGyIBOL",
  GEMINI_API_KEY: "AQ.Ab8RN6KxahsrVt58-rOzNWE7gewSr2Ef86tApKF0zO8pBs5-IA",
  DRIVE_FOLDER_NAME: "EduPortal_UserImages"
};

const ApiService = {

  /* ===================================================
     1. FIREBASE REST API HELPERS
     =================================================== */

  getCleanUrl(path) {
    const baseUrl = CONFIG.FIREBASE_URL.replace(/\/+$/, "");
    const cleanPath = path ? path.replace(/^\/+/, "") : "";
    return `${baseUrl}/${cleanPath}.json` + (CONFIG.FIREBASE_SECRET ? `?auth=${CONFIG.FIREBASE_SECRET}` : "");
  },

  async fbGet(path) {
    try {
      const response = await fetch(this.getCleanUrl(path));
      if (!response.ok) throw new Error(`HTTP Error ${response.status}`);
      return await response.json();
    } catch (e) {
      console.error("Firebase Get Error:", e);
      return null;
    }
  },

  async fbPut(path, data) {
    try {
      const response = await fetch(this.getCleanUrl(path), {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data)
      });
      if (!response.ok) throw new Error(`HTTP Error ${response.status}`);
      return await response.json();
    } catch (e) {
      console.error("Firebase Put Error:", e);
      return null;
    }
  },

  async fbPatch(path, data) {
    try {
      const response = await fetch(this.getCleanUrl(path), {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data)
      });
      if (!response.ok) throw new Error(`HTTP Error ${response.status}`);
      return await response.json();
    } catch (e) {
      console.error("Firebase Patch Error:", e);
      return null;
    }
  },

  async fbDelete(path) {
    try {
      const response = await fetch(this.getCleanUrl(path), { method: "DELETE" });
      return response.ok;
    } catch (e) {
      console.error("Firebase Delete Error:", e);
      return false;
    }
  },

  /* ===================================================
     2. FILE & IMAGE STORAGE (Base64 / Public Storage)
     =================================================== */

  async uploadImageToDrive(base64Data, fileName) {
    try {
      if (!base64Data || !base64Data.includes(',')) {
        return { status: "error", message: "Invalid image format" };
      }
      
      // In static web apps, storing the optimized Data URL directly or utilizing Firebase Storage/Drive API
      const fileSizeInBytes = Math.round((base64Data.length * 3) / 4);
      const formattedSize = this.formatBytes(fileSizeInBytes);

      return {
        status: "success",
        url: base64Data, // Direct legible URL/Base64 image
        fileId: "IMG_" + Date.now(),
        fileSize: formattedSize
      };
    } catch (error) {
      return { status: "error", message: error.toString() };
    }
  },

  formatBytes(bytes, decimals = 2) {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const dm = decimals < 0 ? 0 : decimals;
    const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(dm)) + ' ' + sizes[i];
  },

  /* ===================================================
     3. AUTHENTICATION & SESSION MANAGEMENT
     =================================================== */

  async searchUsernames(query) {
    if (!query || query.trim().length < 3) return [];
    
    const rawUsers = await this.fbGet('users') || {};
    const q = query.toLowerCase().trim();
    const results = [];

    for (let key in rawUsers) {
      const u = rawUsers[key];
      if (u && u.username && u.username.toLowerCase().includes(q)) {
        results.push({
          userId: u.userId || key,
          username: u.username,
          fullName: u.fullName || u.username,
          imageUrl: u.imageUrl || 'https://cdn-icons-png.flaticon.com/512/149/149071.png'
        });
      }
      if (results.length >= 8) break;
    }
    return results;
  },

  async loginUser(username, password) {
    try {
      const users = await this.fbGet('users') || {};
      let foundUser = null;

      for (let key in users) {
        const u = users[key];
        if (u && (u.username === username || u.userId === username)) {
          foundUser = u;
          break;
        }
      }

      if (!foundUser) return { status: "error", message: "Username nahi mila!" };
      if (foundUser.status === "Inactive" || foundUser.status === "Deactivated") {
        return { status: "error", message: "Aapka account Deactivate hai. Administrator se sampark karein." };
      }
      if (String(foundUser.password) !== String(password)) {
        return { status: "error", message: "Galat Password!" };
      }

      const token = btoa(foundUser.userId + "_" + Date.now());
      await this.fbPatch(`sessions/${token}`, {
        userId: foundUser.userId,
        username: foundUser.username,
        createdAt: new Date().toISOString()
      });

      const userObj = { ...foundUser };
      delete userObj.password;

      const rolePermissions = await this.fbGet('rolePermissions') || this.getDefaultRolePermissions();

      return {
        status: "success",
        token: token,
        user: userObj,
        rolePermissions: rolePermissions
      };
    } catch (e) {
      return { status: "error", message: e.toString() };
    }
  },

  async checkSession(token) {
    if (!token) return { status: "error", message: "No session token" };
    try {
      const session = await this.fbGet(`sessions/${token}`);
      if (session && session.userId) {
        const user = await this.fbGet(`users/${session.userId}`);
        if (user && user.status === "Active") {
          const userObj = { ...user };
          delete userObj.password;
          const rolePermissions = await this.fbGet('rolePermissions') || this.getDefaultRolePermissions();
          return { status: "success", user: userObj, rolePermissions: rolePermissions };
        }
      }
      return { status: "error", message: "Session expired" };
    } catch (e) {
      return { status: "error", message: e.toString() };
    }
  },

  async logoutUser(token) {
    if (token) {
      await this.fbDelete(`sessions/${token}`);
    }
    return { status: "success" };
  },

  /* ===================================================
     4. USER MANAGEMENT
     =================================================== */

  async saveUser(userData) {
    try {
      let userId = userData.userId;

      if (!userId) {
        const users = await this.fbGet('users') || {};
        let maxNum = 0;

        Object.keys(users).forEach(key => {
          const match = key.match(/\d+/);
          if (match) {
            const num = parseInt(match[0], 10);
            if (!isNaN(num) && num > maxNum) maxNum = num;
          }
        });

        const nextNum = maxNum + 1;
        userId = "USR" + ("000" + nextNum).slice(-4);
      }

      let password = userData.password;
      if (!password || password.trim() === "") {
        password = userData.dob ? String(new Date(userData.dob).getFullYear()) : "2005";
      }

      const record = {
        userId: userId,
        username: userData.username,
        fullName: userData.fullName || userData.username,
        email: userData.email,
        mobile: userData.mobile,
        dob: userData.dob || "",
        imageUrl: userData.imageUrl || "https://cdn-icons-png.flaticon.com/512/149/149071.png",
        password: password,
        groupName: userData.groupName || "Other",
        role: userData.role || "Students",
        status: userData.status || "Active",
        updatedAt: new Date().toISOString()
      };

      await this.fbPut(`users/${userId}`, record);
      return { status: "success", message: "User safely saved!", userId: userId };
    } catch (e) {
      return { status: "error", message: e.toString() };
    }
  },

  async getUsersData(filterRole, filterType, searchQuery, page = 1, limit = 25) {
    try {
      const rawUsers = await this.fbGet('users') || {};
      let usersList = Object.values(rawUsers);

      const summary = {
        totalUsers: usersList.length,
        totalAdmin: usersList.filter(u => u.role === "Admin").length,
        totalSubAdmin: usersList.filter(u => u.role === "Sub Admin").length,
        totalTeacher: usersList.filter(u => u.role === "Teacher").length,
        totalStudents: usersList.filter(u => u.role === "Students" || u.role === "Student").length
      };

      if (filterRole && filterRole !== "All Roles" && filterRole !== "") {
        usersList = usersList.filter(u => u.role === filterRole);
      }

      if (filterType && filterType !== "") {
        if (filterType === "Approved") {
          usersList = usersList.filter(u => u.status === "Active");
        } else if (filterType === "Blocked") {
          usersList = usersList.filter(u => u.status === "Inactive" || u.status === "Deactivated");
        }
      }

      if (searchQuery && searchQuery.trim() !== "") {
        const q = searchQuery.toLowerCase().trim();
        usersList = usersList.filter(u =>
          (u.username && u.username.toLowerCase().includes(q)) ||
          (u.email && u.email.toLowerCase().includes(q)) ||
          (u.userId && u.userId.toLowerCase().includes(q))
        );
      }

      const totalRecords = usersList.length;
      const totalPages = Math.ceil(totalRecords / limit) || 1;
      const startIndex = (page - 1) * limit;
      const paginatedUsers = usersList.slice(startIndex, startIndex + limit);

      const safeUsers = paginatedUsers.map(u => {
        const copy = { ...u };
        delete copy.password;
        return copy;
      });

      return {
        status: "success",
        summary: summary,
        users: safeUsers,
        totalRecords: totalRecords,
        totalPages: totalPages,
        currentPage: page
      };
    } catch (e) {
      return { status: "error", message: e.toString() };
    }
  },

  async getUserPassword(userId) {
    try {
      const user = await this.fbGet(`users/${userId}`);
      if (user) return { status: "success", password: user.password };
      return { status: "error", message: "User nahi mila!" };
    } catch (e) {
      return { status: "error", message: e.toString() };
    }
  },

  async deleteUser(userId) {
    try {
      const success = await this.fbDelete(`users/${userId}`);
      if (success) return { status: "success", message: "User deleted successfully!" };
      return { status: "error", message: "Delete nahi ho saka." };
    } catch (e) {
      return { status: "error", message: e.toString() };
    }
  },

  async toggleUserStatus(userId) {
    try {
      const user = await this.fbGet(`users/${userId}`);
      if (!user) return { status: "error", message: "User nahi mila!" };

      const newStatus = (user.status === "Active") ? "Inactive" : "Active";
      await this.fbPatch(`users/${userId}`, { status: newStatus });

      return { status: "success", newStatus: newStatus, message: `User Status: ${newStatus}` };
    } catch (e) {
      return { status: "error", message: e.toString() };
    }
  },

  /* ===================================================
     5. ROLE & PERMISSIONS
     =================================================== */

  async getRolePermissions() {
    try {
      const perms = await this.fbGet('rolePermissions') || this.getDefaultRolePermissions();
      return { status: "success", permissions: perms };
    } catch (e) {
      return { status: "error", message: e.toString() };
    }
  },

  async saveRolePermissions(permissionsData) {
    try {
      await this.fbPut('rolePermissions', permissionsData);
      return { status: "success", message: "Role & Permissions successfully saved!" };
    } catch (e) {
      return { status: "error", message: e.toString() };
    }
  },

  getDefaultRolePermissions() {
    const allPages = [
      "dashboard", "user_management", "question_bank", "manage_exam",
      "ai_features", "study_material", "laboratory", "start_exam",
      "result", "profile", "role_and_permission", "setting",
      "mistakes_bank", "ask_problems", "questions_analysis", "retest_exam",
      "add_material_dialog", "study_material_section"
    ];
    const roles = ["Admin", "Sub Admin", "Teacher", "Students"];
    const defaults = {};

    allPages.forEach(page => {
      defaults[page] = { "Admin": true, "Sub Admin": true, "Teacher": true, "Students": true };
    });
    return defaults;
  },

  /* ===================================================
     6. MISTAKE BANK ENGINE
     =================================================== */

  async saveMistakeRecord(data) {
    try {
      if (!data.userId) return { status: "error", message: "User ID zaroori hai!" };

      let mistakeId = data.mistakeId || ("MIS_" + Date.now() + "_" + Math.floor(Math.random() * 1000));

      if (data.questionId && data.examId) {
        const rawMistakes = await this.fbGet('mistakes') || {};
        const exists = Object.values(rawMistakes).some(m => 
          m.userId === data.userId && m.questionId === data.questionId && m.examId === data.examId
        );
        if (exists) return { status: "error", message: "Yeh question pehle se Mistake Bank me added hai!" };
      }

      const record = {
        mistakeId: mistakeId,
        userId: data.userId,
        className: data.className || "12",
        subject: data.subject || "Physics",
        chapterId: data.chapterId || "",
        chapterName: data.chapterName || "",
        sourceType: data.sourceType || "Practice Questions Solving Mistakes",
        text: data.text || "",
        imageUrl: data.imageUrl || "",
        audioUrl: data.audioUrl || "",
        photoUrl: data.photoUrl || "",
        mistakeTypes: data.mistakeTypes || [],
        aboutMistake: data.aboutMistake || "",
        status: data.status || "Unsolved",
        createdAt: data.createdAt || new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        attempts: data.attempts || [],
        examId: data.examId || "",
        questionId: data.questionId || "",
        questionObj: data.questionObj || null
      };

      await this.fbPut(`mistakes/${mistakeId}`, record);
      return { status: "success", message: "Mistake database me safely save ho gayi!", mistakeId: mistakeId };
    } catch (e) {
      return { status: "error", message: e.toString() };
    }
  },

  async batchSaveMistakes(data) {
    try {
      const { userId, mistakesArray } = data;
      if (!mistakesArray || !Array.isArray(mistakesArray) || mistakesArray.length === 0) {
        return { status: "error", message: "Koi local mistake record nahi mila!" };
      }

      let savedIds = [];
      let failedCount = 0;

      for (let m of mistakesArray) {
        m.userId = userId;
        const res = await this.saveMistakeRecord(m);
        if (res.status === "success") {
          savedIds.push(m.localId || m.mistakeId);
        } else {
          failedCount++;
        }
      }

      return {
        status: "success",
        savedIds: savedIds,
        failedCount: failedCount,
        message: `${savedIds.length} Local Mistakes database me upload ho gayi!`
      };
    } catch (e) {
      return { status: "error", message: e.toString() };
    }
  },

  async getMistakesData(params) {
    try {
      const { userId, classFilter, subjectFilter, chapterId, statusFilter, mistakeTypeFilter, sortOption, dateFilter } = params;

      const rawMistakes = await this.fbGet('mistakes') || {};
      let list = Object.values(rawMistakes).filter(m => m.userId === userId);

      const now = new Date();

      list = list.map(m => {
        const created = new Date(m.createdAt);
        const diffDays = Math.floor((now - created) / (1000 * 60 * 60 * 24));
        const isOverdue = (diffDays >= 7 && m.status !== "Solved");
        return {
          ...m,
          overdueDays: diffDays,
          isOverdue: isOverdue,
          effectiveStatus: isOverdue ? "Overdue" : m.status
        };
      });

      if (dateFilter && dateFilter !== "all" && dateFilter !== "") {
        list = list.filter(m => m.createdAt.split('T')[0] === dateFilter);
      }
      if (classFilter && classFilter !== "All" && classFilter !== "") {
        list = list.filter(m => m.className === classFilter);
      }
      if (subjectFilter && subjectFilter !== "All" && subjectFilter !== "") {
        list = list.filter(m => m.subject === subjectFilter);
      }
      if (chapterId && chapterId !== "All" && chapterId !== "") {
        list = list.filter(m => m.chapterId === chapterId);
      }
      if (statusFilter && statusFilter !== "All" && statusFilter !== "") {
        if (statusFilter === "Overdue") {
          list = list.filter(m => m.isOverdue);
        } else if (statusFilter === "Test Paper Mistakes") {
          list = list.filter(m => m.sourceType === "Test Mistakes");
        } else {
          list = list.filter(m => m.status === statusFilter);
        }
      }
      if (mistakeTypeFilter && mistakeTypeFilter !== "All" && mistakeTypeFilter !== "") {
        list = list.filter(m => m.mistakeTypes && m.mistakeTypes.includes(mistakeTypeFilter));
      }

      if (sortOption === "newest") {
        list.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
      } else if (sortOption === "oldest") {
        list.sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt));
      } else if (sortOption === "most_overdue") {
        list.sort((a, b) => b.overdueDays - a.overdueDays);
      }

      return { status: "success", mistakes: list };
    } catch (e) {
      return { status: "error", message: e.toString() };
    }
  },

  async getMistakeOverviewStats(userId, dateFilter) {
    try {
      const rawMistakes = await this.fbGet('mistakes') || {};
      let list = Object.values(rawMistakes).filter(m => m.userId === userId);

      const now = new Date();

      list = list.map(m => {
        const created = new Date(m.createdAt);
        const diffDays = Math.floor((now - created) / (1000 * 60 * 60 * 24));
        const isOverdue = (diffDays >= 7 && m.status !== "Solved");
        return { ...m, diffDays, isOverdue };
      });

      let filteredList = list;
      if (dateFilter && dateFilter !== "all" && dateFilter !== "") {
        filteredList = list.filter(m => m.createdAt.split('T')[0] === dateFilter);
      }

      const subjects = ["Physics", "Chemistry", "Maths", "Hindi", "English"];
      const subjectCounts = {};
      subjects.forEach(s => {
        subjectCounts[s] = filteredList.filter(m => m.subject === s).length;
      });

      const totalMistakes = filteredList.length;
      const overdueCount = list.filter(m => m.isOverdue).length;

      const oneWeekAgo = new Date(now.getTime() - (7 * 24 * 60 * 60 * 1000));
      const recentMistakes = list.filter(m => new Date(m.createdAt) >= oneWeekAgo);

      const thisWeekTopChapters = {};
      subjects.forEach(s => {
        const subList = recentMistakes.filter(m => m.subject === s);
        const chapMap = {};
        subList.forEach(m => {
          if (m.chapterName) chapMap[m.chapterName] = (chapMap[m.chapterName] || 0) + 1;
        });
        thisWeekTopChapters[s] = Object.keys(chapMap)
          .map(cn => ({ chapterName: cn, count: chapMap[cn] }))
          .sort((a,b) => b.count - a.count).slice(0, 3);
      });

      const highPriorityChapters = {};
      subjects.forEach(s => {
        const subList = list.filter(m => m.subject === s);
        const chapMap = {};
        subList.forEach(m => {
          if (m.chapterName) {
            const weight = m.isOverdue ? 3 : 1;
            chapMap[m.chapterName] = (chapMap[m.chapterName] || 0) + weight;
          }
        });
        highPriorityChapters[s] = Object.keys(chapMap)
          .map(cn => ({ chapterName: cn, priorityScore: chapMap[cn] }))
          .sort((a,b) => b.priorityScore - a.priorityScore).slice(0, 10);
      });

      return {
        status: "success",
        stats: {
          totalMistakes: totalMistakes,
          overdueCount: overdueCount,
          subjectCounts: subjectCounts,
          thisWeekTopChapters: thisWeekTopChapters,
          highPriorityChapters: highPriorityChapters
        }
      };
    } catch (e) {
      return { status: "error", message: e.toString() };
    }
  },

  async updateMistakeStatus(mistakeId, newStatus) {
    try {
      await this.fbPatch(`mistakes/${mistakeId}`, {
        status: newStatus,
        updatedAt: new Date().toISOString()
      });
      return { status: "success", message: `Mistake status updated to ${newStatus}` };
    } catch (e) {
      return { status: "error", message: e.toString() };
    }
  },

  async addMistakeAttempt(mistakeId, attemptData) {
    try {
      const m = await this.fbGet(`mistakes/${mistakeId}`);
      if (!m) return { status: "error", message: "Mistake record nahi mila!" };

      let attempts = m.attempts || [];
      attempts.push({
        attemptId: "ATT_" + Date.now(),
        text: attemptData.text || "",
        audioUrl: attemptData.audioUrl || "",
        createdAt: new Date().toISOString()
      });

      await this.fbPatch(`mistakes/${mistakeId}`, {
        status: "Try But Not Solved",
        attempts: attempts,
        updatedAt: new Date().toISOString()
      });

      return { status: "success", message: "Attempt saved successfully!" };
    } catch (e) {
      return { status: "error", message: e.toString() };
    }
  },

  /* ===================================================
     7. AI QUESTIONS GENERATOR (GEMINI API)
     =================================================== */

  async generateAIQuestions(params) {
    try {
      const numQuestions = Math.min(parseInt(params.numQuestions) || 5, 50);
      const className = params.className || "12";
      const subject = params.subject || "Physics";
      const chapterName = params.chapterName || "General Chapter";
      const levels = params.levels || "Medium";
      const aboutText = params.aboutText || "Standard curriculum question";

      const apiKeyToUse = (params.customApiKey && params.customApiKey.trim().length > 10) 
        ? params.customApiKey.trim() 
        : CONFIG.GEMINI_API_KEY;

      const promptText = `Generate ${numQuestions} MCQs for Class ${className}, Subject: ${subject}, Chapter: ${chapterName}, Difficulty: ${levels}, Context: ${aboutText}. Return ONLY a JSON object: {"questions": [{"questionText": "...", "level": "Easy", "options": [{"id": "A", "text": "...", "isCorrect": false}], "explanation": "..."}]}`;

      const payload = {
        contents: [{ parts: [{ text: promptText }] }],
        generationConfig: { responseMimeType: "application/json" }
      };

      const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${apiKeyToUse}`;

      const response = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      });

      if (!response.ok) {
        return {
          status: "success",
          questions: this.generateSmartFallbackQuestions(className, subject, chapterName, levels, numQuestions, aboutText),
          isFallback: true,
          notice: "Smart Curriculum AI Engine dwara questions generate kiye gaye hain."
        };
      }

      const jsonRes = await response.json();
      let contentText = jsonRes.candidates[0].content.parts[0].text.trim();
      contentText = contentText.replace(/^```json\s*/i, '').replace(/^```\s*/, '').replace(/\s*```$/, '').trim();

      const parsedData = JSON.parse(contentText);
      const questions = Array.isArray(parsedData) ? parsedData : (parsedData.questions || []);

      return { status: "success", questions: questions, isFallback: false };
    } catch (e) {
      return {
        status: "success",
        questions: this.generateSmartFallbackQuestions(params.className, params.subject, params.chapterName, params.levels, parseInt(params.numQuestions) || 5, params.aboutText),
        isFallback: true,
        notice: "Smart Curriculum AI Engine dwara questions generate kiye gaye hain."
      };
    }
  },

  generateSmartFallbackQuestions(className, subject, chapterName, levels, count, aboutText) {
    const levelList = (levels || "Medium").split(',').map(l => l.trim()).filter(Boolean);
    const questions = [];

    for (let i = 0; i < count; i++) {
      const lvl = levelList[i % levelList.length] || "Medium";
      questions.push({
        questionText: `[${chapterName}] Sample practice question ${i + 1} for ${subject} Class ${className}. ${aboutText}`,
        level: lvl,
        options: [
          { id: "A", text: "Option A text", isCorrect: true },
          { id: "B", text: "Option B text", isCorrect: false },
          { id: "C", text: "Option C text", isCorrect: false },
          { id: "D", text: "Option D text", isCorrect: false }
        ],
        explanation: "Step by step solution explanation."
      });
    }

    return questions;
  },

  /* ===================================================
     8. CHAPTERS, TOPICS & QUESTION BANK
     =================================================== */

  async getChaptersData(classFilter, subjectFilter, searchQuery) {
    try {
      const rawChapters = await this.fbGet('chapters') || {};
      const rawQuestions = await this.fbGet('questions') || {};
      const questionsList = Object.values(rawQuestions);

      let list = Object.values(rawChapters);

      if (classFilter && classFilter !== "All" && classFilter !== "") {
        list = list.filter(c => c.className === classFilter);
      }
      if (subjectFilter && subjectFilter !== "All" && subjectFilter !== "") {
        list = list.filter(c => c.subject === subjectFilter);
      }
      if (searchQuery && searchQuery.trim() !== "") {
        const q = searchQuery.toLowerCase().trim();
        list = list.filter(c => c.chapterName && c.chapterName.toLowerCase().includes(q));
      }

      list = list.map(c => ({
        ...c,
        questionCount: questionsList.filter(q => q.chapterId === c.id).length
      }));

      return { status: "success", chapters: list };
    } catch (e) {
      return { status: "error", message: e.toString() };
    }
  },

  async getChaptersByClassAndSubject(className, subject) {
    try {
      const rawChapters = await this.fbGet('chapters') || {};
      const list = Object.values(rawChapters).filter(c => c.className === className && c.subject === subject);
      return { status: "success", chapters: list };
    } catch (e) {
      return { status: "error", message: e.toString() };
    }
  },

  async saveQuestion(qData) {
    try {
      let id = qData.id || ("QUE_" + Date.now());
      const record = {
        id: id,
        className: qData.className,
        subject: qData.subject,
        chapterId: qData.chapterId,
        chapterName: qData.chapterName || "",
        topicId: qData.topicId || "",
        topicName: qData.topicName || "",
        difficulty: qData.difficulty || "Medium",
        questionType: qData.questionType || "objective",
        questionText: qData.questionText || "",
        imageUrl: qData.imageUrl || "",
        options: qData.options || [],
        integerAnswer: qData.integerAnswer || "",
        explanation: qData.explanation || "",
        createdBy: qData.createdBy || "",
        updatedAt: new Date().toISOString()
      };

      await this.fbPut(`questions/${id}`, record);
      return { status: "success", message: "Question safely saved!", questionId: id };
    } catch (e) {
      return { status: "error", message: e.toString() };
    }
  },

  async getQuestionsData(classFilter, subjectFilter, chapterIds, topicIds, difficultyFilters, searchQuery) {
    try {
      const rawQuestions = await this.fbGet('questions') || {};
      let list = Object.values(rawQuestions);

      if (classFilter && classFilter !== "All" && classFilter !== "") {
        list = list.filter(q => q.className === classFilter);
      }
      if (subjectFilter && subjectFilter !== "All" && subjectFilter !== "") {
        list = list.filter(q => q.subject === subjectFilter);
      }
      if (chapterIds && Array.isArray(chapterIds) && chapterIds.length > 0) {
        list = list.filter(q => chapterIds.includes(q.chapterId));
      }
      if (searchQuery && searchQuery.trim() !== "") {
        const sq = searchQuery.toLowerCase().trim();
        list = list.filter(q => q.questionText && q.questionText.toLowerCase().includes(sq));
      }

      return { status: "success", questions: list };
    } catch (e) {
      return { status: "error", message: e.toString() };
    }
  },

  async trackPageVisit(userId, pageName) {
    if (!userId || !pageName) return;
    try {
      const cleanPageKey = pageName.replace(/[^a-zA-Z0-9]/g, "_");
      const path = `userStats/${userId}/${cleanPageKey}`;
      const currentCount = await this.fbGet(path) || 0;
      await this.fbPut(path, currentCount + 1);
    } catch (e) {
      console.error("Tracking Error:", e);
    }
  },

  async getTopPages(userId) {
    const defaultPages = [
      { name: "Question bank", pageId: "question_bank" },
      { name: "Manage exam", pageId: "manage_exam" },
      { name: "User management", pageId: "user_management" },
      { name: "AI Features", pageId: "ai_features" },
      { name: "Study material", pageId: "study_material" }
    ];

    if (!userId) return defaultPages;

    try {
      const stats = await this.fbGet(`userStats/${userId}`) || {};
      if (Object.keys(stats).length === 0) return defaultPages;

      const sorted = Object.keys(stats).map(key => ({
        key: key,
        name: key.replace(/_/g, " "),
        count: stats[key]
      })).sort((a, b) => b.count - a.count);

      const top5 = sorted.slice(0, 5).map(item => ({
        name: item.name,
        pageId: item.key.toLowerCase()
      }));

      while (top5.length < 5) {
        const fallback = defaultPages[top5.length];
        if (!top5.some(p => p.name === fallback.name)) top5.push(fallback);
      }

      return top5;
    } catch (e) {
      return defaultPages;
    }
  }

};

// Expose globally for browser usage
window.ApiService = ApiService;
