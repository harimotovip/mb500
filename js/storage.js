/**
 * MB-500 Storage Management
 * Handles persistence for answers, wrong question notebook, bookmarks, exams, and settings.
 */

const STORAGE_KEYS = {
  SETTINGS: 'mb500_settings',
  ANSWERS: 'mb500_answers',
  MISTAKES: 'mb500_mistakes',
  STARRED: 'mb500_starred',
  EXAMS: 'mb500_exams',
  CURRENT_INDEX: 'mb500_curr_idx'
};

class StorageManager {
  constructor() {
    this.settings = this.load(STORAGE_KEYS.SETTINGS, {
      language: 'ja', // 'ja' | 'en' | 'bilingual'
      theme: 'dark',   // 'dark' | 'light'
      autoNext: false
    });
    this.answers = this.load(STORAGE_KEYS.ANSWERS, {});
    this.mistakes = this.load(STORAGE_KEYS.MISTAKES, {});
    this.starred = new Set(this.load(STORAGE_KEYS.STARRED, []));
    this.exams = this.load(STORAGE_KEYS.EXAMS, []);
    this.currentIndex = this.load(STORAGE_KEYS.CURRENT_INDEX, 0);
  }

  load(key, fallback) {
    try {
      const data = localStorage.getItem(key);
      return data ? JSON.parse(data) : fallback;
    } catch (e) {
      console.error('Storage read error:', e);
      return fallback;
    }
  }

  save(key, val) {
    try {
      localStorage.setItem(key, JSON.stringify(val));
    } catch (e) {
      console.error('Storage write error:', e);
    }
  }

  saveSettings(newSettings) {
    this.settings = { ...this.settings, ...newSettings };
    this.save(STORAGE_KEYS.SETTINGS, this.settings);
  }

  setCurrentIndex(index) {
    this.currentIndex = index;
    this.save(STORAGE_KEYS.CURRENT_INDEX, index);
  }

  recordAnswer(qId, selectedOption, isCorrect, mode = 'practice') {
    const record = {
      qId,
      selected: selectedOption,
      isCorrect,
      timestamp: Date.now(),
      mode
    };
    this.answers[qId] = record;
    this.save(STORAGE_KEYS.ANSWERS, this.answers);

    if (!isCorrect) {
      const current = this.mistakes[qId] || { count: 0, firstWrong: Date.now(), mastered: false };
      current.count += 1;
      current.lastWrong = Date.now();
      current.mastered = false;
      this.mistakes[qId] = current;
      this.save(STORAGE_KEYS.MISTAKES, this.mistakes);
    } else if (this.mistakes[qId] && mode === 'mistakes') {
      // If practiced in mistakes mode and answered correctly
      this.mistakes[qId].mastered = true;
      this.save(STORAGE_KEYS.MISTAKES, this.mistakes);
    }
  }

  toggleStar(qId) {
    if (this.starred.has(qId)) {
      this.starred.delete(qId);
    } else {
      this.starred.add(qId);
    }
    this.save(STORAGE_KEYS.STARRED, Array.from(this.starred));
    return this.starred.has(qId);
  }

  isStarred(qId) {
    return this.starred.has(qId);
  }

  removeMistake(qId) {
    delete this.mistakes[qId];
    this.save(STORAGE_KEYS.MISTAKES, this.mistakes);
  }

  markMistakeMastered(qId, mastered = true) {
    if (this.mistakes[qId]) {
      this.mistakes[qId].mastered = mastered;
      this.save(STORAGE_KEYS.MISTAKES, this.mistakes);
    }
  }

  saveExamResult(examResult) {
    this.exams.unshift(examResult);
    if (this.exams.length > 50) this.exams.pop();
    this.save(STORAGE_KEYS.EXAMS, this.exams);
  }

  getStatistics(allQuestions = []) {
    const totalQuestions = allQuestions.length || 400;
    const answeredIds = Object.keys(this.answers);
    const totalAnswered = answeredIds.length;
    const correctCount = answeredIds.filter(id => this.answers[id].isCorrect).length;
    const mistakeIds = Object.keys(this.mistakes).filter(id => !this.mistakes[id].mastered);
    const starredCount = this.starred.size;

    const accuracy = totalAnswered > 0 ? Math.round((correctCount / totalAnswered) * 100) : 0;

    // Topic stats
    const topicStats = {};
    for (const q of allQuestions) {
      if (!topicStats[q.topic]) {
        topicStats[q.topic] = {
          topic: q.topic,
          name_ja: q.topic_name_ja,
          total: 0,
          answered: 0,
          correct: 0
        };
      }
      topicStats[q.topic].total += 1;
      if (this.answers[q.id]) {
        topicStats[q.topic].answered += 1;
        if (this.answers[q.id].isCorrect) {
          topicStats[q.topic].correct += 1;
        }
      }
    }

    return {
      totalQuestions,
      totalAnswered,
      correctCount,
      accuracy,
      unansweredCount: totalQuestions - totalAnswered,
      mistakeCount: mistakeIds.length,
      starredCount,
      topicStats: Object.values(topicStats)
    };
  }

  exportData() {
    return JSON.stringify({
      settings: this.settings,
      answers: this.answers,
      mistakes: this.mistakes,
      starred: Array.from(this.starred),
      exams: this.exams,
      version: 1,
      exportedAt: new Date().toISOString()
    }, null, 2);
  }

  importData(jsonStr) {
    try {
      const data = JSON.parse(jsonStr);
      if (data.settings) this.saveSettings(data.settings);
      if (data.answers) {
        this.answers = data.answers;
        this.save(STORAGE_KEYS.ANSWERS, this.answers);
      }
      if (data.mistakes) {
        this.mistakes = data.mistakes;
        this.save(STORAGE_KEYS.MISTAKES, this.mistakes);
      }
      if (data.starred) {
        this.starred = new Set(data.starred);
        this.save(STORAGE_KEYS.STARRED, Array.from(this.starred));
      }
      if (data.exams) {
        this.exams = data.exams;
        this.save(STORAGE_KEYS.EXAMS, this.exams);
      }
      return true;
    } catch (e) {
      console.error('Import failed:', e);
      return false;
    }
  }

  clearProgress() {
    this.answers = {};
    this.mistakes = {};
    this.currentIndex = 0;
    this.save(STORAGE_KEYS.ANSWERS, {});
    this.save(STORAGE_KEYS.MISTAKES, {});
    this.save(STORAGE_KEYS.CURRENT_INDEX, 0);
  }
}

window.appStorage = new StorageManager();
