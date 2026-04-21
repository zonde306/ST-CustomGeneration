import { z, ZodTypeAny } from 'zod';

/**
 * Recursively merge two Zod schemas, schemaB will deeply override schemaA.
 * @param schemaA 
 * @param schemaB 
 * @returns 
 */
export function deepMergeZod(schemaA: ZodTypeAny, schemaB: ZodTypeAny): ZodTypeAny {
    // By enabling internal checks and using `as any`, the `ts(2740)` and `ts(2345)` errors caused by Zod v4's internal `$ZodType` are avoided.
    const unwrappedA = unwrapZodType(schemaA as any);
    const unwrappedB = unwrapZodType(schemaB as any);

    let mergedCore: any;

    // Get the actual runtime type name (compatible with _def.typeName for Zod v3 and _zod.type for Zod v4).
    const typeA = unwrappedA.core._def?.typeName ?? unwrappedA.core.def?.type;
    const typeB = unwrappedB.core._def?.typeName ?? unwrappedB.core.def?.type;

    const isObjA = typeA === 'ZodObject' || typeA === 'object';
    const isObjB = typeB === 'ZodObject' || typeB === 'object';

    const isArrA = typeA === 'ZodArray' || typeA === 'array';
    const isArrB = typeB === 'ZodArray' || typeB === 'array';

    if (isObjA && isObjB) {
        // Shape extraction compatible with both v3 and v4
        const shapeA = unwrappedA.core.shape || unwrappedA.core.def?.def?.shape;
        const shapeB = unwrappedB.core.shape || unwrappedB.core.def?.def?.shape;
        const mergedShape: Record<string, any> = { ...shapeA };

        for (const key in shapeB) {
            if (key in shapeA) {
                mergedShape[key] = deepMergeZod(shapeA[key], shapeB[key]);
            } else {
                mergedShape[key] = shapeB[key];
            }
        }
        mergedCore = z.object(mergedShape);
    } else if (isArrA && isArrB) {
        // Element extraction compatible with both v3 and v4
        const elementA = unwrappedA.core.element || unwrappedA.core.def?.def?.element;
        const elementB = unwrappedB.core.element || unwrappedB.core.def?.def?.element;
        mergedCore = z.array(deepMergeZod(elementA, elementB));
    } else {
        mergedCore = unwrappedB.core;
    }

    const ukA = getUnknownKeysStrategy(unwrappedA.core);
    const ukB = getUnknownKeysStrategy(unwrappedB.core);
    // If one party is loose and the other party is not never, then the merged schema is loose.
    if ((ukB === 'passthrough' || ukB === 'unknown' || ukA === 'unknown' || ukA === 'passthrough') && ukA !== 'never' && ukB !== 'never') {
        mergedCore = mergedCore.loose();
    }

    // Restore the optional/nullable state of the outer layer (based on the overriding layer B).
    let finalSchema = mergedCore;
    if (unwrappedB.isNullable) finalSchema = finalSchema.nullable();
    if (unwrappedB.isOptional) finalSchema = finalSchema.optional();

    // Return by casting back to a public type
    return finalSchema as ZodTypeAny;
}

/**
 * Recursive unpacking of ZodSchema
 * @param schema 
 * @returns 
 */
function unwrapZodType(schema: any) {
    let isOptional = false;
    let isNullable = false;
    let current = schema;

    // Try unwrapping the object if it has an unwrap method.
    while (current && typeof current.unwrap === 'function') {
        const typeName = current._def?.typeName ?? current.def?.type;

        if (typeName === 'ZodOptional' || typeName === 'optional') {
            isOptional = true;
            current = current.unwrap(); // Since current is any, ts(2740) will not be triggered here.
        } else if (typeName === 'ZodNullable' || typeName === 'nullable') {
            isNullable = true;
            current = current.unwrap();
        } else {
            break;
        }
    }

    return { core: current, isOptional, isNullable };
}

function getUnknownKeysStrategy(schemaCore: any): 'never' | 'strip' | 'passthrough' | 'unknown' {
    return schemaCore._def?.unknownKeys ?? schemaCore._def?.catchall?.type ?? schemaCore.def?.catchall?.type ?? 'strip';
}

// ==================== 生理数据 ====================
const PhysiologicalDataSchema = z.object({
    胸部状态: z.string().optional().describe("乳房的当前状态（如大小、敏感度等）"),
    孕肚状态: z.string().optional().describe("腹部/孕肚的外观与状态描述"),
    小穴状态: z.string().optional().describe("阴道部位的状态描述"),
    子宫状态: z.string().optional().describe("子宫的健康或妊娠状态"),
    羊膜状态: z.string().optional().describe("羊膜囊的状态（如完整、破裂等）"),
    胎儿状态: z.string().optional().describe("胎儿的发育或活动状态"),
    处女状态: z.string().optional().describe("处女膜状态或破处原因/对象"),
    妊娠状态: z.string().optional().describe("当前妊娠阶段（如孕早期、中期等）"),
    胎儿父亲: z.string().optional().describe("胎儿父亲的名字或身份"),
    妊娠症状: z.string().optional().describe("妊娠相关症状（如孕吐、疲劳等）"),
    妊娠想法: z.string().optional().describe("角色对怀孕的内心看法或感受"),
}).optional().describe("角色的生理特征与妊娠相关数据");

// ==================== 社交关系条目 ====================
const RelationEntrySchema = z.object({
    关系: z.string().optional().describe("与其他角色的关系描述（如朋友、恋人、主仆等）"),
    好感: z.number().int().optional().describe("好感度，范围 0～100，数值越高关系越亲密"),
    性欲: z.number().int().optional().describe("性欲程度，范围 0～100，数值越高欲望越强"),
    服从: z.number().int().optional().describe("服从度，范围 0～100，数值越高越倾向听从对方"),
    依赖: z.number().int().optional().describe("依赖度，范围 0～100，数值越高越离不开对方"),
}).optional().describe("针对单个角色的社交关系指标");

// 社交关系表：键为角色名，值为该角色的关系条目
const SocialRelationsSchema = z.record(z.string(), RelationEntrySchema).optional().describe("社交关系映射表，键为角色名，值为关系数据");

// ==================== 内心想法 ====================
const InnerThoughtsSchema = z.record(z.string(), z.string().optional()).optional().describe("内心想法映射表，键为目标角色名或'自己'，值为对应的想法文字");

// ==================== 单个角色 ====================
const CharacterSchema = z.object({
    名字: z.string().optional().describe("角色的名称"),
    年龄: z.number().int().min(0).optional().describe("年龄，整数，范围 0～Inf"),
    性格: z.string().optional().describe("性格简介或关键词"),
    当前行动: z.string().optional().describe("角色当前正在进行的动作或行为"),
    外观: z.string().optional().describe("外观描述，约150词，涵盖服装类型、颜色、风格及整体时尚感"),
    生理数据: PhysiologicalDataSchema,
    社交关系: SocialRelationsSchema,
    内心想法: InnerThoughtsSchema,
    日记: z.string().optional().describe("当天发生的重要事件记录"),
}).optional().describe("单个角色的完整档案");

// 角色列表：键为角色名，值为角色档案
const CharacterListSchema = z.record(z.string(), CharacterSchema).optional().describe("角色列表，键为角色名，值为对应的角色数据");

// ==================== 顶层 statusData ====================
const StatusDataSchema = z.object({
    日期: z.string()
        .regex(/^\d{4}-\d{2}-\d{2}$/, "日期格式必须为 YYYY-MM-DD，例如 2025-12-31")
        .optional()
        .describe("日期，格式 YYYY-MM-DD"),
    时间: z.string()
        .regex(/^\d{2}:\d{2}$/, "时间格式必须为 HH:MM，24小时制，例如 14:30")
        .optional()
        .describe("时间，格式 HH:MM，24小时制"),
    地点: z.string().optional().describe("当前所在位置或场景"),
    在场角色: z.array(z.string()).optional().describe("当前场景中出现的角色名称列表"),
    角色列表: CharacterListSchema,
}).optional().describe("场景状态数据，包含时间、地点及所有角色信息");

// ==================== 完整数据结构 ====================
const FullDataSchema = z.object({
    statusData: StatusDataSchema,
}).describe("完整的数据结构，最外层包含 statusData 对象");

registerSchema(FullDataSchema);
