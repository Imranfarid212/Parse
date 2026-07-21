const fs = require("fs");
const path = require("path");

const packageRoot = path.join(
  __dirname,
  "..",
  "node_modules",
  "expo-modules-core",
  "node_modules",
  "expo-modules-jsi",
  "apple",
  "Sources",
  "ExpoModulesJSI",
);

const files = [
  "Contexts/HostFunctionContext.swift",
  "Contexts/HostObjectContext.swift",
  "Runtime/JavaScriptActor.swift",
  "Runtime/JavaScriptPropNameID.swift",
  "Runtime/Values/JavaScriptArray.swift",
  "Runtime/Values/JavaScriptArrayBuffer.swift",
  "Runtime/Values/JavaScriptBigInt.swift",
  "Runtime/Values/JavaScriptError.swift",
  "Runtime/Values/JavaScriptFunction.swift",
  "Runtime/Values/JavaScriptObject.swift",
  "Runtime/Values/JavaScriptPromise.swift",
  "Runtime/Values/JavaScriptTypedArray.swift",
  "Runtime/Values/JavaScriptValue.swift",
  "Runtime/Values/JavaScriptWeakObject.swift",
];

let changed = 0;

for (const file of files) {
  const filePath = path.join(packageRoot, file);

  if (!fs.existsSync(filePath)) {
    continue;
  }

  const source = fs.readFileSync(filePath, "utf8");
  const patched = source.replace(/weak let runtime/g, "weak var runtime");

  if (patched !== source) {
    fs.writeFileSync(filePath, patched);
    changed += 1;
  }
}

const sendablePatches = [
  [
    "Coding/JavaScriptCodable+Date.swift",
    [["abs(milliseconds) <= maxJavaScriptDateMilliseconds", "Swift.abs(milliseconds) <= maxJavaScriptDateMilliseconds"]],
  ],
  [
    "Contexts/HostFunctionContext.swift",
    [
      ["internal final class HostFunctionContext: Sendable", "internal final class HostFunctionContext: @unchecked Sendable"],
      [
        "internal final class UnownedThisHostFunctionContext: Sendable",
        "internal final class UnownedThisHostFunctionContext: @unchecked Sendable",
      ],
    ],
  ],
  [
    "Contexts/HostObjectContext.swift",
    [["internal final class HostObjectContext: Sendable", "internal final class HostObjectContext: @unchecked Sendable"]],
  ],
  [
    "Runtime/Values/JavaScriptError.swift",
    [["public final class JavaScriptError: Error, Sendable", "public final class JavaScriptError: Error, @unchecked Sendable"]],
  ],
  [
    "Runtime/Values/JavaScriptValue.swift",
    [
      [
        "public final class JavaScriptValue: JavaScriptType, Equatable, Escapable",
        "public final class JavaScriptValue: JavaScriptType, Equatable, Escapable, @unchecked Sendable",
      ],
    ],
  ],
  [
    "Runtime/JavaScriptPropNameID.swift",
    [
      [
        "public final class JavaScriptPropNameID: JavaScriptType",
        "public final class JavaScriptPropNameID: JavaScriptType, @unchecked Sendable",
      ],
    ],
  ],
];

for (const [file, replacements] of sendablePatches) {
  const filePath = path.join(packageRoot, file);

  if (!fs.existsSync(filePath)) {
    continue;
  }

  let source = fs.readFileSync(filePath, "utf8");
  let patched = source;

  for (const [from, to] of replacements) {
    if (!patched.includes(to)) {
      patched = patched.replace(from, to);
    }
  }

  if (patched !== source) {
    fs.writeFileSync(filePath, patched);
    changed += 1;
  }
}

if (changed > 0) {
  console.log(
    `[postinstall] Patched ExpoModulesJSI for Xcode 26.1 (${changed} files).`,
  );
}
