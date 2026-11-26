/**
 * MB-500 Question Interaction & Grading Engine
 * Supports Single Choice, Multi Choice, Hotspot Dropdowns, and Touch Drag & Drop
 */

class InteractionEngine {
  constructor() {
    this.selectedSingle = null;
    this.selectedMulti = new Set();
    this.dragPlacements = {}; // { [slotIndex]: itemData }
    this.activeDragSource = null;
    this.hotspotSelections = {}; // { [boxIndex]: optionValue }
  }

  resetCurrent() {
    this.selectedSingle = null;
    this.selectedMulti.clear();
    this.dragPlacements = {};
    this.activeDragSource = null;
    this.hotspotSelections = {};
  }

  // --- Single Choice ---
  handleSingleSelect(key, onSelectCallback) {
    this.selectedSingle = key;
    if (onSelectCallback) onSelectCallback(key);
  }

  // --- Multi Choice ---
  handleMultiToggle(key, onToggleCallback) {
    if (this.selectedMulti.has(key)) {
      this.selectedMulti.delete(key);
    } else {
      this.selectedMulti.add(key);
    }
    if (onToggleCallback) onToggleCallback(Array.from(this.selectedMulti));
  }

  // --- Drag and Drop (Desktop + Mobile Tap-to-Place) ---
  setupDragAndDrop(container, qData, onChangeCallback) {
    this.dragPlacements = {};
    this.activeDragSource = null;
    this.currentDragQ = qData;

    const sourceItems = container.querySelectorAll('.drag-item');
    const targetSlots = container.querySelectorAll('.drop-slot');

    // 1. Desktop HTML5 Drag
    sourceItems.forEach(item => {
      item.addEventListener('dragstart', (e) => {
        e.dataTransfer.setData('text/plain', item.dataset.id);
        item.classList.add('dragging');
      });

      item.addEventListener('dragend', () => {
        item.classList.remove('dragging');
      });

      // 2. Mobile Tap-to-Select
      item.addEventListener('click', () => {
        sourceItems.forEach(s => s.classList.remove('selected-source'));
        if (this.activeDragSource === item.dataset.id) {
          this.activeDragSource = null;
        } else {
          this.activeDragSource = item.dataset.id;
          item.classList.add('selected-source');
        }
      });
    });

    // Drop Slot Handlers
    targetSlots.forEach(slot => {
      slot.addEventListener('dragover', (e) => {
        e.preventDefault();
        slot.classList.add('drag-hover');
      });

      slot.addEventListener('dragleave', () => {
        slot.classList.remove('drag-hover');
      });

      slot.addEventListener('drop', (e) => {
        e.preventDefault();
        slot.classList.remove('drag-hover');
        const itemId = e.dataTransfer.getData('text/plain');
        this.placeItemInSlot(itemId, slot.dataset.slotIndex, container, onChangeCallback);
      });

      // Mobile Tap Slot to Place active selected item
      slot.addEventListener('click', () => {
        if (this.activeDragSource) {
          this.placeItemInSlot(this.activeDragSource, slot.dataset.slotIndex, container, onChangeCallback);
          this.activeDragSource = null;
          sourceItems.forEach(s => s.classList.remove('selected-source'));
        } else if (this.dragPlacements[slot.dataset.slotIndex]) {
          // Tap occupied slot to remove item
          this.removeItemFromSlot(slot.dataset.slotIndex, container, onChangeCallback);
        }
      });
    });
  }

  placeItemInSlot(itemId, slotIndex, container, callback) {
    const sourceEl = container.querySelector(`.drag-item[data-id="${itemId}"]`);
    if (!sourceEl) return;

    const q = this.currentDragQ || {};
    const allowReuse = (q.drag_actions && q.drag_slots && (q.drag_actions.length < q.drag_slots.length || q.drag_slots.some(s => s.label_en)));

    // If this slot already had another item, free it if not used elsewhere
    const prev = this.dragPlacements[slotIndex];
    if (prev && prev.id !== itemId) {
      const stillUsed = Object.entries(this.dragPlacements).some(([k, v]) => k !== String(slotIndex) && v.id === prev.id);
      if (!stillUsed) {
        const prevEl = container.querySelector(`.drag-item[data-id="${prev.id}"]`);
        if (prevEl) prevEl.classList.remove('already-used');
      }
    }

    this.dragPlacements[slotIndex] = {
      id: itemId,
      text: sourceEl.innerText.trim(),
      enText: sourceEl.dataset.en || sourceEl.innerText.trim()
    };

    const targetSlot = container.querySelector(`.drop-slot[data-slot-index="${slotIndex}"]`);
    if (targetSlot) {
      targetSlot.innerHTML = `
        <div class="placed-item">
          <span>${sourceEl.innerText.trim()}</span>
          <span class="remove-btn" title="Remove">&times;</span>
        </div>
      `;
      targetSlot.classList.add('filled');
      if (!allowReuse) {
        sourceEl.classList.add('already-used');
      }
    }

    if (callback) callback(this.dragPlacements);
  }

  removeItemFromSlot(slotIndex, container, callback) {
    const placed = this.dragPlacements[slotIndex];
    if (!placed) return;

    delete this.dragPlacements[slotIndex];
    const stillUsed = Object.values(this.dragPlacements).some(v => v.id === placed.id);
    if (!stillUsed) {
      const sourceEl = container.querySelector(`.drag-item[data-id="${placed.id}"]`);
      if (sourceEl) {
        sourceEl.classList.remove('already-used');
      }
    }

    const targetSlot = container.querySelector(`.drop-slot[data-slot-index="${slotIndex}"]`);
    if (targetSlot) {
      const ph = targetSlot.dataset.placeholder || `Step ${parseInt(slotIndex) + 1} (点击或拖拽放入)`;
      targetSlot.innerHTML = `<span class="slot-placeholder">${ph}</span>`;
      targetSlot.classList.remove('filled');
    }

    if (callback) callback(this.dragPlacements);
  }

  // --- Hotspot Dropdowns ---
  setHotspotSelection(boxId, val) {
    this.hotspotSelections[boxId] = val;
  }

  // --- Evaluate Answer ---
  gradeQuestion(q) {
    const targetAns = (q.ai_verdict && q.ai_verdict.correct_answer) ? q.ai_verdict.correct_answer.toUpperCase().trim() : '';
    let isCorrect = false;
    let userAnsStr = '';

    if (q.type === 'single_choice' || q.type === 'exhibit_choice') {
      userAnsStr = this.selectedSingle || '';
      isCorrect = (userAnsStr.toUpperCase() === targetAns);
    } else if (q.type === 'multi_choice') {
      const selectedArr = Array.from(this.selectedMulti).sort();
      userAnsStr = selectedArr.join('');
      // Compare sorted keys (e.g. 'CD' vs 'CD')
      const targetSorted = targetAns.split('').sort().join('');
      isCorrect = (userAnsStr.toUpperCase() === targetSorted);
    } else if (q.type === 'hotspot') {
      if (q.hotspot_boxes && q.hotspot_boxes.length > 0) {
        let correctCount = 0;
        const total = q.hotspot_boxes.length;
        const userAnswers = [];
        q.hotspot_boxes.forEach(box => {
          const userVal = this.hotspotSelections[box.box_id];
          userAnswers.push(`Box ${box.box_id}: ${userVal || '未选'}`);
          if (userVal && userVal.trim().toLowerCase() === box.answer.trim().toLowerCase()) {
            correctCount++;
          }
        });
        isCorrect = (correctCount === total);
        userAnsStr = userAnswers.join(' | ');
      } else {
        userAnsStr = 'Checked Solution';
        isCorrect = true;
      }
    } else if (q.type === 'drag_drop') {
      const expected = (window.mbApp && window.mbApp.extractStepsEn) ? window.mbApp.extractStepsEn(q) : [];
      const norm = s => (window.mbApp && window.mbApp.normalizeDragText)
        ? window.mbApp.normalizeDragText(s)
        : (s || '').toLowerCase().replace(/\.$/, '').trim();
      const slotCount = (q.drag_slots && q.drag_slots.length) || expected.length || 4;
      const slotResults = [];
      let correctSlots = 0;

      for (let i = 0; i < slotCount; i++) {
        const placed = this.dragPlacements[i];
        const userEn = placed ? (placed.enText || placed.text) : '';
        const exp = expected[i] || '';
        const ok = !!exp && norm(userEn) === norm(exp);
        if (ok) correctSlots++;
        slotResults.push({
          slotIndex: i,
          isCorrect: ok,
          userText: userEn,
          expectedText: exp
        });
      }

      if (Object.keys(this.dragPlacements).length > 0) {
        userAnsStr = Object.keys(this.dragPlacements)
          .sort()
          .map(k => `${parseInt(k)+1}: ${this.dragPlacements[k].text}`)
          .join(', ');
        isCorrect = (expected.length > 0 && correctSlots === expected.length);
      } else {
        userAnsStr = '未作答';
        isCorrect = false;
      }

      return {
        isCorrect,
        userAnswer: userAnsStr,
        correctAnswer: targetAns,
        dumpAnswer: q.dump_answer,
        aiAnswer: q.ai_verdict.correct_answer,
        isDumpFlawed: q.ai_verdict.is_dump_wrong,
        slotResults
      };
    }

    return {
      isCorrect,
      userAnswer: userAnsStr,
      correctAnswer: targetAns,
      dumpAnswer: q.dump_answer,
      aiAnswer: q.ai_verdict.correct_answer,
      isDumpFlawed: q.ai_verdict.is_dump_wrong
    };
  }
}

window.appInteractions = new InteractionEngine();
