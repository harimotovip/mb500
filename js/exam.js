/**
 * MB-500 Mock Exam Engine
 * Full-featured exam simulator: timed test, score calculation, pass/fail grading,
 * question navigation sheet, and detailed review.
 */

class ExamEngine {
  constructor() {
    this.isActive = false;
    this.questions = [];
    this.currentIndex = 0;
    this.userAnswers = {}; // { [index]: answerData }
    this.flagged = new Set();
    this.startTime = null;
    this.timerInterval = null;
    this.durationSeconds = 7200; // 120 mins
    this.timeRemaining = 7200;
    this.examConfig = null;
    this.examResult = null;
  }

  startExam(allQuestions, config = {}) {
    this.isActive = true;
    this.examConfig = {
      mode: config.mode || 'standard', // 'standard' (50), 'quick' (20), 'topic', 'all' (400), 'all_random' (400 shuffled), 'mistakes'
      topicId: config.topicId || null,
      timed: config.timed !== false,
      duration: config.duration || ((config.mode === 'all' || config.mode === 'all_random') ? 14400 : 7200)
    };

    // Filter or sample questions
    let pool = [...allQuestions];
    if (this.examConfig.mode === 'topic' && this.examConfig.topicId) {
      pool = pool.filter(q => q.topic === parseInt(this.examConfig.topicId));
    } else if (this.examConfig.mode === 'mistakes') {
      const mistakeIds = Object.keys(window.appStorage.mistakes).filter(id => !window.appStorage.mistakes[id].mastered);
      pool = pool.filter(q => mistakeIds.includes(String(q.id)));
      if (pool.length === 0) pool = allQuestions.slice(0, 20);
    }

    if (this.examConfig.mode === 'quick') {
      this.questions = this.shuffle(pool).slice(0, 20);
    } else if (this.examConfig.mode === 'standard') {
      this.questions = this.shuffle(pool).slice(0, 50);
    } else if (this.examConfig.mode === 'all') {
      this.questions = pool; // all 400 questions in order
    } else if (this.examConfig.mode === 'all_random') {
      this.questions = this.shuffle(pool); // all 400 questions shuffled!
    } else {
      this.questions = pool;
    }

    this.currentIndex = 0;
    this.userAnswers = {};
    this.flagged = new Set();
    this.startTime = Date.now();
    this.timeRemaining = this.examConfig.duration;
    this.examResult = null;

    if (this.examConfig.timed) {
      this.startTimer();
    }
  }

  shuffle(array) {
    const arr = [...array];
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
  }

  startTimer() {
    if (this.timerInterval) clearInterval(this.timerInterval);
    this.timerInterval = setInterval(() => {
      this.timeRemaining -= 1;
      if (this.onTick) this.onTick(this.formatTime(this.timeRemaining));
      if (this.timeRemaining <= 0) {
        this.submitExam();
      }
    }, 1000);
  }

  formatTime(seconds) {
    if (seconds < 0) seconds = 0;
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    const s = seconds % 60;
    if (h > 0) {
      return `${h}:${m < 10 ? '0' : ''}${m}:${s < 10 ? '0' : ''}${s}`;
    }
    return `${m < 10 ? '0' : ''}${m}:${s < 10 ? '0' : ''}${s}`;
  }

  recordAnswer(qIndex, answerData) {
    this.userAnswers[qIndex] = answerData;
  }

  toggleFlag(qIndex) {
    if (this.flagged.has(qIndex)) {
      this.flagged.delete(qIndex);
    } else {
      this.flagged.add(qIndex);
    }
    return this.flagged.has(qIndex);
  }

  submitExam() {
    if (this.timerInterval) clearInterval(this.timerInterval);
    this.isActive = false;

    const timeSpent = Math.floor((Date.now() - this.startTime) / 1000);
    let correctCount = 0;
    const reviewedQuestions = [];
    const topicBreakdown = {};

    this.questions.forEach((q, idx) => {
      const userAns = this.userAnswers[idx] || { selected: '', isCorrect: false };
      const targetAns = q.ai_verdict.correct_answer.toUpperCase().trim();
      let isCorrect = false;

      if (q.type === 'single_choice' || q.type === 'exhibit_choice') {
        isCorrect = (userAns.selected.toUpperCase() === targetAns);
      } else if (q.type === 'multi_choice') {
        const u = (userAns.selected || '').split('').sort().join('').toUpperCase();
        const t = targetAns.split('').sort().join('').toUpperCase();
        isCorrect = (u === t);
      } else {
        // Hotspot / Drag & Drop
        isCorrect = userAns.selected ? true : false;
      }

      if (isCorrect) correctCount += 1;

      // Log in storage
      window.appStorage.recordAnswer(q.id, userAns.selected, isCorrect, 'exam');

      // Topic stats
      if (!topicBreakdown[q.topic]) {
        topicBreakdown[q.topic] = {
          topic: q.topic,
          name: q.topic_name_ja,
          total: 0,
          correct: 0
        };
      }
      topicBreakdown[q.topic].total += 1;
      if (isCorrect) topicBreakdown[q.topic].correct += 1;

      reviewedQuestions.push({
        question: q,
        index: idx,
        userAnswer: userAns.selected,
        isCorrect,
        isFlagged: this.flagged.has(idx)
      });
    });

    const totalQuestions = this.questions.length;
    const accuracy = totalQuestions > 0 ? Math.round((correctCount / totalQuestions) * 100) : 0;
    // Microsoft Passing Scale: 700 / 1000
    const scaledScore = Math.round((correctCount / totalQuestions) * 1000);
    const passed = scaledScore >= 700;

    this.examResult = {
      examId: 'exam_' + Date.now(),
      timestamp: Date.now(),
      mode: this.examConfig.mode,
      totalQuestions,
      correctCount,
      wrongCount: totalQuestions - correctCount,
      scaledScore,
      passed,
      accuracy,
      timeSpent,
      timeSpentFormatted: this.formatTime(timeSpent),
      topicBreakdown: Object.values(topicBreakdown),
      reviewedQuestions
    };

    window.appStorage.saveExamResult(this.examResult);
    return this.examResult;
  }
}

window.appExam = new ExamEngine();
