import * as React from 'react';
import { Text, Section } from '@react-email/components';
import { EmailLayout } from './EmailLayout';

export interface RegistrationRejectedEmailProps {
    name: string;
    buildingName: string;
    reason?: string;
}

const headingStyle: React.CSSProperties = {
    fontSize: '22px',
    fontWeight: 700,
    color: '#111827',
    margin: '0 0 8px 0',
};

const bodyText: React.CSSProperties = {
    fontSize: '15px',
    color: '#374151',
    lineHeight: '1.6',
    margin: '0 0 16px 0',
};

const reasonBox: React.CSSProperties = {
    backgroundColor: '#fef2f2',
    border: '1px solid #fecaca',
    borderRadius: '8px',
    padding: '16px 20px',
    margin: '16px 0',
};

const reasonLabel: React.CSSProperties = {
    fontSize: '12px',
    fontWeight: 600,
    color: '#6b7280',
    margin: '0 0 4px 0',
    textTransform: 'uppercase',
    letterSpacing: '0.5px',
};

const reasonText: React.CSSProperties = {
    fontSize: '15px',
    color: '#374151',
    margin: 0,
};

const noteText: React.CSSProperties = {
    fontSize: '13px',
    color: '#6b7280',
    margin: '16px 0 0 0',
};

export function RegistrationRejectedEmail({ name, buildingName, reason }: RegistrationRejectedEmailProps) {
    return (
        <EmailLayout preview={`Tu solicitud de ingreso a ${buildingName} no fue aprobada`}>
            <Text style={headingStyle}>Solicitud no aprobada</Text>
            <Text style={bodyText}>
                Hola <strong>{name}</strong>, lamentamos informarte que tu solicitud de ingreso al edificio
                <strong> {buildingName}</strong> no fue aprobada.
            </Text>

            {reason && (
                <Section style={reasonBox}>
                    <Text style={reasonLabel}>Motivo indicado</Text>
                    <Text style={reasonText}>{reason}</Text>
                </Section>
            )}

            <Text style={noteText}>
                Si crees que esto es un error, por favor contacta directamente al administrador de tu edificio para mayor información.
            </Text>
        </EmailLayout>
    );
}
