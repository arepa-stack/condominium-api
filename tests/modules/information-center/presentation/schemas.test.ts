import { describe, expect, it } from 'bun:test';
import { Value } from '@sinclair/typebox/value';
import {
    CreateAnnouncementBody,
    RuleBody,
    UpdateAnnouncementBody,
    UpdateRuleBody,
} from '@/modules/information-center/presentation/schemas';

describe('information-center multipart schemas — boolean/numeric coercion', () => {
    const baseAnnouncement = {
        building_id: '29af607b-e445-41ab-91e5-e75e4b61e836',
        title: 'Test',
        content: 'Test',
    };

    describe('CreateAnnouncementBody.is_pinned', () => {
        it('decodes string "true" to true (multipart payload)', () => {
            const result = Value.Decode(CreateAnnouncementBody, {
                ...baseAnnouncement,
                is_pinned: 'true',
            });
            expect(result.is_pinned).toBe(true);
        });

        it('decodes string "false" to false (multipart payload)', () => {
            const result = Value.Decode(CreateAnnouncementBody, {
                ...baseAnnouncement,
                is_pinned: 'false',
            });
            expect(result.is_pinned).toBe(false);
        });

        it('accepts native boolean true (JSON payload)', () => {
            const result = Value.Decode(CreateAnnouncementBody, {
                ...baseAnnouncement,
                is_pinned: true,
            });
            expect(result.is_pinned).toBe(true);
        });

        it('accepts omitted is_pinned (optional)', () => {
            const result = Value.Decode(CreateAnnouncementBody, baseAnnouncement);
            expect(result.is_pinned).toBeUndefined();
        });
    });

    describe('UpdateAnnouncementBody.is_pinned', () => {
        it('decodes string "true" to true', () => {
            const result = Value.Decode(UpdateAnnouncementBody, { is_pinned: 'true' });
            expect(result.is_pinned).toBe(true);
        });
    });

    describe('RuleBody — is_published + sort_order', () => {
        const baseRule = {
            building_id: '29af607b-e445-41ab-91e5-e75e4b61e836',
            title: 'Rule',
            content: 'Body',
        };

        it('decodes is_published "true" to true', () => {
            const result = Value.Decode(RuleBody, { ...baseRule, is_published: 'true' });
            expect(result.is_published).toBe(true);
        });

        it('decodes sort_order "5" to number 5', () => {
            const result = Value.Decode(RuleBody, { ...baseRule, sort_order: '5' });
            expect(result.sort_order).toBe(5);
        });

        it('accepts native sort_order number', () => {
            const result = Value.Decode(RuleBody, { ...baseRule, sort_order: 3 });
            expect(result.sort_order).toBe(3);
        });
    });

    describe('UpdateRuleBody — is_published + sort_order', () => {
        it('decodes string scalars from multipart', () => {
            const result = Value.Decode(UpdateRuleBody, {
                is_published: 'false',
                sort_order: '10',
            });
            expect(result.is_published).toBe(false);
            expect(result.sort_order).toBe(10);
        });
    });
});
