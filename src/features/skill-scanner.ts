import { WorldInfoEntry, Skill } from '@/utils/defines';
import { filterWIByDecorator, getWorldInfoSorter } from '@/functions/worldinfo';

/**
 * Skill scanner that manages skill collection and activation
 */
export class SkillScanner {
    private allSkills: Skill[] = [];
    private initialActivatedSkills: Skill[] = [];
    private activatedSkills: Skill[] = [];

    /**
     * Initialize skill scanner with all possible skills and initial activated ones
     */
    constructor() {}

    /**
     * Collect all possible skills and set initial activated skills
     * @param allEntries All possible world info entries
     * @param initialActivatedEntries Initial activated world info entries
     */
    initialize(allEntries: WorldInfoEntry[], initialActivatedEntries: WorldInfoEntry[]): void {
        const allSkillEntries = filterWIByDecorator(allEntries, ['@@skill']);
        this.allSkills = allSkillEntries.map(entry => this.parseSkill(entry)).filter(Boolean) as Skill[];
        // Sort all skills for reference
        this.sortSkills(this.allSkills);

        const initialActivatedSkillEntries = filterWIByDecorator(initialActivatedEntries, ['@@skill']);
        this.initialActivatedSkills = initialActivatedSkillEntries.map(entry => this.parseSkill(entry)).filter(Boolean) as Skill[];
        // Sort initial activated skills
        this.sortSkills(this.initialActivatedSkills);
        this.activatedSkills = [...this.initialActivatedSkills];
    }

    /**
     * Sort skills array in place using World Info ordering rules
     */
    private sortSkills(skills: Skill[]): void {
        const entries = skills.map(s => s.entry);
        skills.sort((a, b) => {
            const sorter = getWorldInfoSorter(entries);
            return sorter(a.entry, b.entry);
        });
    }

    /**
     * Parse a world info entry into a skill
     * @param entry World info entry
     * @returns Skill or null if parsing fails
     */
    private parseSkill(entry: WorldInfoEntry): Skill | null {
        const lines = entry.content.split('\n');
        if (lines.length <= 1) {
            return null;
        }

        const description = lines[0].trim();
        const body = lines.slice(1).join('\n').trim();

        return {
            name: entry.comment,
            description,
            body,
            entry,
        };
    }

    /**
     * Get all collected skills
     * @returns Array of skills
     */
    getAllSkills(): Skill[] {
        return [...this.allSkills];
    }

    /**
     * Get currently activated skills
     * @returns Array of activated skills
     */
    getActivatedSkills(): Skill[] {
        return [...this.activatedSkills];
    }

    /**
     * Add a skill to activated skills by name or uid
     * @param name Skill name or uid
     * @returns Object indicating if added and the skill
     */
    addSkill(name: string | number): { added: boolean; skill: Skill | null } {
        const skill = this.allSkills.find(s => 
            s.name === name || s.entry.uid === name
        );

        if (!skill) {
            return { added: false, skill: null };
        }

        // Check if already activated
        if (this.activatedSkills.some(s => s.entry.uid === skill.entry.uid)) {
            return { added: false, skill };
        }

        this.activatedSkills.push(skill);
        this.sortSkills(this.activatedSkills);
        return { added: true, skill };
    }

    /**
     * Remove a skill from activated skills
     * @param name Skill name or uid
     * @returns True if skill was found and removed
     */
    removeSkill(name: string | number): boolean {
        const initialLength = this.activatedSkills.length;
        this.activatedSkills = this.activatedSkills.filter(s => 
            s.name !== name && s.entry.uid !== name
        );
        return this.activatedSkills.length < initialLength;
    }

    /**
     * Clear all activated skills except the initial ones
     */
    resetActivatedSkills(): void {
        this.activatedSkills = [...this.initialActivatedSkills];
    }
}
