# Technical Design: P1 可靠性缺陷修复

## 1. 桌面端场景与可用时间设置持久化

### 模块边界
`apps/mobile/lib/engine-context.ts`

### 现有逻辑
```ts
function getBackend(): KeyValue {
  if (backend === null) {
    backend = isReactNativeRuntime() ? createSecureStoreStore() : createMemoryStore();
  }
  return backend;
}
```
由于桌面端（Tauri）和 Web 环境下 `isReactNativeRuntime()` 为 `false`，默认回退到了纯内存 `createMemoryStore()`，导致页面刷新或桌面客户端重启后设置重置。

### 设计方案
1. 封装 `createLocalStorageStore()`：
   ```ts
   function createLocalStorageStore(): KeyValue {
     return {
       async getItem(key) {
         try {
           return window.localStorage.getItem(key);
         } catch {
           return null;
         }
       },
       async setItem(key, value) {
         try {
           window.localStorage.setItem(key, value);
         } catch {
           // ignore quota or security error
         }
       },
     };
   }
   ```
2. 运行时检测：
   若环境拥有 `window.localStorage` 或全局可用 `localStorage`（且读写正常），在非原生移动端优先使用 LocalStorage 存储；若抛出异常或处于无存储环境（如无模拟的 Node 环境），降级到 `createMemoryStore()`。

---

## 2. 习惯周期日历天计算优化

### 模块边界
`packages/db/src/queries/pool.ts` 中的 `habitCycleDay`

### 现有逻辑
```ts
export function habitCycleDay(startedAt: string, cycleDays: number, localDate: string): number | null {
  const startedAtMs = parseIso(startedAt).getTime();
  for (let day = 0; day < cycleDays; day++) {
    if (localDateKey(new Date(startedAtMs + day * DAY_MS)) === localDate) {
      return day + 1;
    }
  }
  return null;
}
```
问题在于 `DAY_MS = 86_400_000` 是绝对物理时间。夏令时转换当天长度为 23 小时或 25 小时，若 `startedAt` 接近午夜，物理加 86400000 毫秒会导致跨日漂移（早或晚一天），从而引发打卡日匹配失效。

### 设计方案
利用标准本地日历日期运算：
从 `startedAt` 取出本地年月日，通过 `new Date(year, month, date + day, 12, 0, 0)`（锚定在中午 12:00）递增本地日历天数。中午 12 点对于任何夏令时/冬令时（±1 小时）都具有充分的容错缓冲区，不会发生跨日误差：
```ts
export function habitCycleDay(startedAt: string, cycleDays: number, localDate: string): number | null {
  const start = parseIso(startedAt);
  const year = start.getFullYear();
  const month = start.getMonth();
  const date = start.getDate();
  for (let day = 0; day < cycleDays; day++) {
    const current = new Date(year, month, date + day, 12, 0, 0);
    if (localDateKey(current) === localDate) {
      return day + 1;
    }
  }
  return null;
}
```

---

## 3. 应用时钟前台恢复实时校准

### 模块边界
`apps/mobile/hooks/use-app-clock.ts`

### 现有逻辑
```ts
export function useAppClock(): Date {
  const [now, setNow] = useState<Date>(() => new Date());

  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), TICK_MS);
    return () => clearInterval(id);
  }, []);

  return now;
}
```
在移动设备或笔记本电脑休眠唤醒时，`setInterval` 暂停并出现时延，醒来后未能及时感知当前最新时刻。

### 设计方案
在 `useEffect` 中挂载前台唤醒监听器：
1. 监听 React Native `AppState` 的 `change` 事件：当 `nextState === 'active'` 时，立即调用 `setNow(new Date())`。
2. 兼容监听 Web / 桌面端环境的 `focus` 和 `visibilitychange` 事件：当可见性变为 `visible` 或窗口重新获得焦点时，立即刷新。
3. 清理函数中正确解绑事件监听器，避免内存泄漏。
