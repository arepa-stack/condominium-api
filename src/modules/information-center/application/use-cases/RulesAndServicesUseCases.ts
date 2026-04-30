import { randomUUID } from 'crypto';
import { NotFoundError } from '@/core/errors';
import { ResidenceRuleCategory } from '../../domain/entities/ResidenceRuleCategory';
import { ResidenceRule } from '../../domain/entities/ResidenceRule';
import { RecommendedService } from '../../domain/entities/RecommendedService';
import { IInformationCenterRepository } from '../../domain/repository';
import {
    InformationCenterCaller,
    ensureCanManageBuilding,
    ensureCanReadBuilding,
    resolveReadableBuildingId,
} from '../access';

export interface RuleCategoryInput {
    caller: InformationCenterCaller;
    buildingId: string;
    name: string;
    description?: string | null;
    icon?: string | null;
    sortOrder?: number;
    isActive?: boolean;
}

export interface RuleInput {
    caller: InformationCenterCaller;
    buildingId: string;
    categoryId?: string | null;
    title: string;
    content: string;
    attachmentPath?: string | null;
    isPublished?: boolean;
    sortOrder?: number;
}

export interface ServiceInput {
    caller: InformationCenterCaller;
    buildingId: string;
    name: string;
    category: string;
    description?: string | null;
    phone?: string | null;
    email?: string | null;
    availability?: string | null;
    rating?: number | null;
    isRecommended?: boolean;
    isActive?: boolean;
}

export class CreateRuleCategory {
    constructor(private readonly repo: IInformationCenterRepository) {}

    async execute(input: RuleCategoryInput): Promise<ResidenceRuleCategory> {
        ensureCanManageBuilding(input.caller, input.buildingId);
        const now = new Date();
        return this.repo.createRuleCategory(new ResidenceRuleCategory({
            id: randomUUID(),
            building_id: input.buildingId,
            name: input.name,
            description: input.description ?? null,
            icon: input.icon ?? null,
            sort_order: input.sortOrder ?? 0,
            is_active: input.isActive ?? true,
            created_at: now,
            updated_at: now,
        }));
    }
}

export class UpdateRuleCategory {
    constructor(private readonly repo: IInformationCenterRepository) {}

    async execute(input: Partial<RuleCategoryInput> & { caller: InformationCenterCaller; id: string }): Promise<ResidenceRuleCategory> {
        const category = await this.repo.findRuleCategoryById(input.id);
        if (!category) throw new NotFoundError('Rule category not found');
        ensureCanManageBuilding(input.caller, category.building_id);

        return this.repo.updateRuleCategory(category.update({
            name: input.name,
            description: input.description,
            icon: input.icon,
            sort_order: input.sortOrder,
            is_active: input.isActive,
        }));
    }
}

export class ListRuleCategories {
    constructor(private readonly repo: IInformationCenterRepository) {}

    async execute(caller: InformationCenterCaller, buildingId?: string, includeInactive = false): Promise<ResidenceRuleCategory[]> {
        const resolvedBuildingId = resolveReadableBuildingId(caller, buildingId);
        return this.repo.listRuleCategories(resolvedBuildingId, includeInactive);
    }
}

export class CreateRule {
    constructor(private readonly repo: IInformationCenterRepository) {}

    async execute(input: RuleInput): Promise<ResidenceRule> {
        ensureCanManageBuilding(input.caller, input.buildingId);
        const now = new Date();
        return this.repo.createRule(new ResidenceRule({
            id: randomUUID(),
            building_id: input.buildingId,
            category_id: input.categoryId ?? null,
            title: input.title,
            content: input.content,
            attachment_path: input.attachmentPath ?? null,
            is_published: input.isPublished ?? false,
            sort_order: input.sortOrder ?? 0,
            deleted_at: null,
            created_at: now,
            updated_at: now,
        }));
    }
}

export class UpdateRule {
    constructor(private readonly repo: IInformationCenterRepository) {}

    async execute(input: Partial<RuleInput> & { caller: InformationCenterCaller; id: string }): Promise<ResidenceRule> {
        const rule = await this.repo.findRuleById(input.id);
        if (!rule) throw new NotFoundError('Rule not found');
        ensureCanManageBuilding(input.caller, rule.building_id);

        return this.repo.updateRule(rule.update({
            category_id: input.categoryId,
            title: input.title,
            content: input.content,
            attachment_path: input.attachmentPath,
            is_published: input.isPublished,
            sort_order: input.sortOrder,
        }));
    }
}

export class DeleteRule {
    constructor(private readonly repo: IInformationCenterRepository) {}

    async execute(caller: InformationCenterCaller, id: string): Promise<void> {
        const rule = await this.repo.findRuleById(id);
        if (!rule) throw new NotFoundError('Rule not found');
        ensureCanManageBuilding(caller, rule.building_id);
        await this.repo.updateRule(rule.softDelete());
    }
}

export class ListRules {
    constructor(private readonly repo: IInformationCenterRepository) {}

    async execute(caller: InformationCenterCaller, buildingId?: string, includeUnpublished = false): Promise<ResidenceRule[]> {
        const resolvedBuildingId = resolveReadableBuildingId(caller, buildingId);
        return this.repo.listRules(resolvedBuildingId, includeUnpublished);
    }
}

export class GetRule {
    constructor(private readonly repo: IInformationCenterRepository) {}

    async execute(caller: InformationCenterCaller, id: string): Promise<ResidenceRule> {
        const rule = await this.repo.findRuleById(id);
        if (!rule || rule.deleted_at) throw new NotFoundError('Rule not found');
        ensureCanReadBuilding(caller, rule.building_id);
        if (!rule.is_published) ensureCanManageBuilding(caller, rule.building_id);
        return rule;
    }
}

export class CreateRecommendedService {
    constructor(private readonly repo: IInformationCenterRepository) {}

    async execute(input: ServiceInput): Promise<RecommendedService> {
        ensureCanManageBuilding(input.caller, input.buildingId);
        const now = new Date();
        return this.repo.createRecommendedService(new RecommendedService({
            id: randomUUID(),
            building_id: input.buildingId,
            name: input.name,
            category: input.category,
            description: input.description ?? null,
            phone: input.phone ?? null,
            email: input.email ?? null,
            availability: input.availability ?? null,
            rating: input.rating ?? null,
            is_recommended: input.isRecommended ?? true,
            is_active: input.isActive ?? true,
            created_at: now,
            updated_at: now,
        }));
    }
}

export class UpdateRecommendedService {
    constructor(private readonly repo: IInformationCenterRepository) {}

    async execute(input: Partial<ServiceInput> & { caller: InformationCenterCaller; id: string }): Promise<RecommendedService> {
        const service = await this.repo.findRecommendedServiceById(input.id);
        if (!service) throw new NotFoundError('Recommended service not found');
        ensureCanManageBuilding(input.caller, service.building_id);

        return this.repo.updateRecommendedService(service.update({
            name: input.name,
            category: input.category,
            description: input.description,
            phone: input.phone,
            email: input.email,
            availability: input.availability,
            rating: input.rating,
            is_recommended: input.isRecommended,
            is_active: input.isActive,
        }));
    }
}

export class DeleteRecommendedService {
    constructor(private readonly repo: IInformationCenterRepository) {}

    async execute(caller: InformationCenterCaller, id: string): Promise<void> {
        const service = await this.repo.findRecommendedServiceById(id);
        if (!service) throw new NotFoundError('Recommended service not found');
        ensureCanManageBuilding(caller, service.building_id);
        await this.repo.updateRecommendedService(service.deactivate());
    }
}

export class ListRecommendedServices {
    constructor(private readonly repo: IInformationCenterRepository) {}

    async execute(caller: InformationCenterCaller, buildingId?: string, includeInactive = false): Promise<RecommendedService[]> {
        const resolvedBuildingId = resolveReadableBuildingId(caller, buildingId);
        return this.repo.listRecommendedServices(resolvedBuildingId, includeInactive);
    }
}

export class GetRecommendedService {
    constructor(private readonly repo: IInformationCenterRepository) {}

    async execute(caller: InformationCenterCaller, id: string): Promise<RecommendedService> {
        const service = await this.repo.findRecommendedServiceById(id);
        if (!service) throw new NotFoundError('Recommended service not found');
        ensureCanReadBuilding(caller, service.building_id);
        if (!service.is_active) ensureCanManageBuilding(caller, service.building_id);
        return service;
    }
}
