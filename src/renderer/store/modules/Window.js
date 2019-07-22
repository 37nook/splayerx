import asyncStorage from '@/helpers/asyncStorage';

const state = {
  windowSize: [0, 0],
  windowMinimumSize: [0, 0],
  windowPosition: [0, 0],
  windowAngle: 0,
  isFullScreen: false,
  isFocused: true,
  isMaximized: false,
  isMinimized: false,
  isHiddenByBossKey: false,
  sizePercent: 0,
  browsingSize: [1200, 900],
  pipSize: [420, 236],
  pipPos: [window.screen.availLeft + 20,
    window.screen.availTop + window.screen.availHeight - 236 - 20],
};

const getters = {
  winWidth: state => state.windowSize[0],
  winHeight: state => state.windowSize[1],
  winSize: state => state.windowSize,
  winRatio: state => state.windowSize[0] / state.windowSize[1],
  winPosX: state => state.windowPosition[0],
  winPosY: state => state.windowPosition[1],
  winPos: state => state.windowPosition,
  winAngle: state => state.windowAngle,
  isFullScreen: state => state.isFullScreen,
  isFocused: state => state.isFocused,
  isMaximized: state => state.isMaximized,
  isMinimized: state => state.isMinimized,
  isHiddenByBossKey: state => state.isHiddenByBossKey,
  sizePercent: state => state.sizePercent,
  browsingSize: state => state.browsingSize,
  pipSize: state => state.pipSize,
  pipPos: state => state.pipPos,
};

const mutations = {
  windowSize(state, payload) {
    state.windowSize = payload;
    state.sizePercent = 0;
  },
  windowMinimumSize(state, payload) {
    state.windowMinimumSize = payload;
  },
  windowPosition(state, payload) {
    state.windowPosition = payload;
  },
  isFullScreen(state, payload) {
    state.isFullScreen = payload;
  },
  isFocused(state, payload) {
    state.isFocused = payload;
  },
  isMaximized(state, payload) {
    state.isMaximized = payload;
  },
  isMinimized(state, payload) {
    state.isMinimized = payload;
  },
  isHiddenByBossKey(state, payload) {
    state.isHiddenByBossKey = payload;
  },
  sizePercentUpdate(state, payload) {
    state.sizePercent = payload;
  },
  windowAngle(state, payload) {
    state.windowAngle = payload;
  },
  browsingSizeUpdate(state, payload) {
    state.browsingSize = payload;
  },
  pipSizeUpdate(state, payload) {
    state.pipSize = payload;
  },
  pipPosUpdate(state, payload) {
    state.pipPos = payload;
  },
};

const actions = {
  updateSizePercent({ commit }, delta) {
    commit('sizePercentUpdate', delta);
  },
  windowRotate90Deg({ commit, state }) {
    (state.windowAngle + 90) === 360 ? commit('windowAngle', 0) : commit('windowAngle', state.windowAngle + 90);
  },
  initWindowRotate({ commit }) {
    commit('windowAngle', 0);
  },
  updateBrowsingSize({ commit }, delta) {
    commit('browsingSizeUpdate', delta);
    asyncStorage.set('browsing', { pipSize: state.pipSize, browsingSize: delta, pipPos: state.pipPos });
  },
  updatePipSize({ commit }, delta) {
    commit('pipSizeUpdate', delta);
    asyncStorage.set('browsing', { pipSize: delta, browsingSize: state.browsingSize, pipPos: state.pipPos });
  },
  updatePipPos({ commit }, delta) {
    commit('pipPosUpdate', delta);
    asyncStorage.set('browsing', { pipSize: state.pipSize, browsingSize: state.browsingSize, pipPos: delta });
  },
};

export default {
  state,
  mutations,
  actions,
  getters,
};
