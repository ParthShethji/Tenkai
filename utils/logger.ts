function ts() {
  return new Date().toISOString();
}

export const info = (...args: any[]) => {
  console.log(`[${ts()}] [INFO]`, ...args);
};

export const warn = (...args: any[]) => {
  console.warn(`[${ts()}] [WARN]`, ...args);
};

export const error = (...args: any[]) => {
  console.error(`[${ts()}] [ERROR]`, ...args);
};
