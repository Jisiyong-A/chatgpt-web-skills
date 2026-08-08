// chatgpt-web-provider 启动前 Node 版本检查 (v1.1.0-hardening)
// provider 使用 node:sqlite: 需要 Node >= 22.13.0 (22.5 加入, 22.13 起无需实验 flag)
const [major, minor] = process.versions.node.split('.').map(Number);
const minimum = [22, 13];

if (major < minimum[0] || (major === minimum[0] && minor < minimum[1])) {
  console.error(
    'chatgpt-web-provider requires Node >= ' +
      minimum[0] + '.' + minimum[1] +
      '. Detected ' + process.versions.node
  );
  process.exit(1);
}
console.log('[check-node] Node ' + process.versions.node + ' OK (>= ' + minimum.join('.') + ')');
