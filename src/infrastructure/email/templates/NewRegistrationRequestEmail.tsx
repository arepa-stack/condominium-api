import * as React from 'react';
import { Text, Button, Section } from '@react-email/components';
import { EmailLayout } from './EmailLayout';

export interface NewRegistrationRequestEmailProps {
    boardMemberName: string;
    applicantName: string;
    applicantEmail: string;
    unitName: string;
    buildingName: string;
    adminUrl: string;
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

const infoBox: React.CSSProperties = {
    backgroundColor: '#eff6ff',
    border: '1px solid #bfdbfe',
    borderRadius: '8px',
    padding: '20px',
    margin: '20px 0',
};

const infoLabel: React.CSSProperties = {
    fontSize: '12px',
    fontWeight: 600,
    color: '#6b7280',
    margin: '0 0 2px 0',
    textTransform: 'uppercase',
    letterSpacing: '0.5px',
};

const infoValue: React.CSSProperties = {
    fontSize: '15px',
    color: '#111827',
    margin: '0 0 12px 0',
    fontWeight: 500,
};

const buttonStyle: React.CSSProperties = {
    backgroundColor: '#1a56db',
    borderRadius: '8px',
    color: '#ffffff',
    fontSize: '15px',
    fontWeight: 600,
    padding: '12px 28px',
    textDecoration: 'none',
    display: 'inline-block',
};

export function NewRegistrationRequestEmail({
    boardMemberName,
    applicantName,
    applicantEmail,
    unitName,
    buildingName,
    adminUrl,
}: NewRegistrationRequestEmailProps) {
    return (
        <EmailLayout preview={`Nueva solicitud de ingreso en ${buildingName} — ${applicantName}`}>
            <Text style={headingStyle}>Nueva solicitud de ingreso</Text>
            <Text style={bodyText}>
                Hola <strong>{boardMemberName}</strong>, se ha recibido una nueva solicitud de registro
                en <strong>{buildingName}</strong>. Revisa los datos y aprueba o rechaza según corresponda.
            </Text>

            <Section style={infoBox}>
                <Text style={infoLabel}>Solicitante</Text>
                <Text style={infoValue}>{applicantName}</Text>
                <Text style={infoLabel}>Correo electrónico</Text>
                <Text style={infoValue}>{applicantEmail}</Text>
                <Text style={infoLabel}>Unidad solicitada</Text>
                <Text style={infoValue}>{unitName}</Text>
            </Section>

            <Button href={adminUrl} style={buttonStyle}>
                Revisar solicitud
            </Button>
        </EmailLayout>
    );
}
