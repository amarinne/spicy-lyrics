// AI persistence and paid-request failures cannot become indistinguishable from valid emptiness.
//
// Detection boundary: `.catch()` handlers whose complete result is an empty block, null,
// undefined, a primitive literal, or an empty object/array. Handlers that log, update state,
// rethrow, or return a computed fallback remain accepted.

const unwrap = (node: any): any => {
  if (node?.type === "ChainExpression" || node?.type === "TSAsExpression"
      || node?.type === "TSNonNullExpression") return unwrap(node.expression);
  return node;
};

const emptyValue = (node: any): boolean => {
  const value = unwrap(node);
  if (!value) return true;
  if (value.type === "Literal") return true;
  if (value.type === "Identifier" && value.name === "undefined") return true;
  if (value.type === "ObjectExpression") return value.properties?.length === 0;
  if (value.type === "ArrayExpression") return value.elements?.length === 0;
  return false;
};

const swallows = (handler: any): boolean => {
  const body = unwrap(handler?.body);
  if (!body) return false;
  if (body.type !== "BlockStatement") return emptyValue(body);
  const statements = body.body ?? [];
  if (statements.length === 0) return true;
  return statements.length === 1 && statements[0]?.type === "ReturnStatement"
    && emptyValue(statements[0].argument);
};

export default {
  meta: { name: "no-swallowed-ai-rejection" },
  rules: {
    "no-swallowed-ai-rejection": {
      meta: {
        type: "problem",
        messages: {
          swallowed: "AI rejection is discarded as an empty value. Record a privacy-safe reason, update state, or propagate the failure.",
        },
      },
      create(context: any) {
        return {
          CallExpression(node: any) {
            const callee = unwrap(node.callee);
            if (callee?.type !== "MemberExpression" || callee.computed
                || callee.property?.name !== "catch") return;
            const handler = node.arguments?.[0];
            if ((handler?.type === "ArrowFunctionExpression" || handler?.type === "FunctionExpression")
                && swallows(handler)) {
              context.report({ node: handler, messageId: "swallowed" });
            }
          },
        };
      },
    },
  },
};
