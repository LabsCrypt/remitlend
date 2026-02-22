"use client";

import React, { useState } from "react";
import { Button } from "../components/ui/Button";
import { Input } from "../components/ui/Input";
import { Card, CardHeader, CardTitle, CardDescription, CardContent, CardFooter } from "../components/ui/Card";
import { Modal } from "../components/ui/Modal";
import { Search, Mail, Lock, User, Terminal, ChevronRight } from "lucide-react";

export default function UIDemoPage() {
    const [isModalOpen, setIsModalOpen] = useState(false);
    const [isLoading, setIsLoading] = useState(false);

    const handleAction = () => {
        setIsLoading(true);
        setTimeout(() => setIsLoading(false), 2000);
    };

    return (
        <div className="min-h-screen bg-gray-50 p-8 dark:bg-zinc-950">
            <div className="mx-auto max-w-5xl space-y-12">
                <section className="space-y-4">
                    <h1 className="text-4xl font-extrabold tracking-tight text-gray-900 dark:text-zinc-50">
                        UI Component Library
                    </h1>
                    <p className="text-lg text-gray-500 dark:text-zinc-400">
                        A boutique collection of reusable atomic components for RemitLend.
                    </p>
                </section>

                {/* Buttons */}
                <section className="space-y-6">
                    <div className="flex items-center gap-2 text-xl font-semibold text-gray-800 dark:text-zinc-200">
                        <ChevronRight className="text-blue-500" />
                        <h2>Buttons</h2>
                    </div>
                    <Card>
                        <CardContent className="pt-6">
                            <div className="flex flex-wrap gap-4">
                                <Button variant="primary">Primary</Button>
                                <Button variant="secondary">Secondary</Button>
                                <Button variant="outline">Outline</Button>
                                <Button variant="ghost">Ghost</Button>
                                <Button variant="danger">Danger</Button>
                            </div>
                            <div className="mt-8 flex flex-wrap items-end gap-4">
                                <Button size="sm">Small</Button>
                                <Button size="md">Medium</Button>
                                <Button size="lg">Large</Button>
                                <Button size="icon" variant="outline">
                                    <Terminal size={18} />
                                </Button>
                            </div>
                            <div className="mt-8 flex flex-wrap gap-4">
                                <Button isLoading={isLoading} onClick={handleAction}>
                                    Click to Load
                                </Button>
                                <Button leftIcon={<Mail size={16} />}>Mail Icon</Button>
                                <Button rightIcon={<ChevronRight size={16} />} variant="secondary">
                                    Next Step
                                </Button>
                            </div>
                        </CardContent>
                    </Card>
                </section>

                {/* Inputs */}
                <section className="space-y-6">
                    <div className="flex items-center gap-2 text-xl font-semibold text-gray-800 dark:text-zinc-200">
                        <ChevronRight className="text-blue-500" />
                        <h2>Inputs</h2>
                    </div>
                    <Card>
                        <CardContent className="space-y-6 pt-6">
                            <div className="grid gap-6 md:grid-cols-2">
                                <Input label="Email" placeholder="you@example.com" leftIcon={<Mail size={18} />} />
                                <Input label="Username" placeholder="johndoe" leftIcon={<User size={18} />} />
                                <Input
                                    label="Password"
                                    type="password"
                                    placeholder="••••••••"
                                    leftIcon={<Lock size={18} />}
                                    helperText="Must be at least 8 characters."
                                />
                                <Input
                                    label="Search"
                                    placeholder="Search resources..."
                                    leftIcon={<Search size={18} />}
                                />
                                <Input
                                    label="Error State"
                                    placeholder="Invalid input"
                                    error="This field is required."
                                />
                                <Input label="Disabled State" value="Locked value" disabled />
                            </div>
                        </CardContent>
                    </Card>
                </section>

                {/* Cards */}
                <section className="space-y-6">
                    <div className="flex items-center gap-2 text-xl font-semibold text-gray-800 dark:text-zinc-200">
                        <ChevronRight className="text-blue-500" />
                        <h2>Cards</h2>
                    </div>
                    <div className="grid gap-6 md:grid-cols-2">
                        <Card>
                            <CardHeader>
                                <CardTitle>Account Overview</CardTitle>
                                <CardDescription>Manage your profile and settings.</CardDescription>
                            </CardHeader>
                            <CardContent>
                                <div className="space-y-4 rounded-lg bg-gray-50 p-4 dark:bg-zinc-900">
                                    <div className="flex justify-between">
                                        <span className="text-sm text-gray-500">Tier</span>
                                        <span className="text-sm font-medium">Premium</span>
                                    </div>
                                    <div className="flex justify-between">
                                        <span className="text-sm text-gray-500">Status</span>
                                        <span className="text-sm font-medium text-green-500">Active</span>
                                    </div>
                                </div>
                            </CardContent>
                            <CardFooter className="justify-end gap-2 text-sm text-gray-500">
                                <Button variant="ghost" size="sm">Cancel</Button>
                                <Button size="sm">Save Changes</Button>
                            </CardFooter>
                        </Card>

                        <Card className="border-blue-100 bg-blue-50/30 dark:border-blue-900/30 dark:bg-blue-950/20">
                            <CardHeader>
                                <CardTitle className="text-blue-600 dark:text-blue-400">Pro Features</CardTitle>
                                <CardDescription>Unlock advanced analytics and priority support.</CardDescription>
                            </CardHeader>
                            <CardContent>
                                <p className="text-sm leading-relaxed text-blue-900/80 dark:text-blue-100/70">
                                    Upgrade to our Pro plan to get access to custom workflows, team collaboration tools, and more.
                                </p>
                            </CardContent>
                            <CardFooter>
                                <Button className="w-full bg-blue-600 hover:bg-blue-700">Upgrade Now</Button>
                            </CardFooter>
                        </Card>
                    </div>
                </section>

                {/* Modals */}
                <section className="space-y-6 pb-12">
                    <div className="flex items-center gap-2 text-xl font-semibold text-gray-800 dark:text-zinc-200">
                        <ChevronRight className="text-blue-500" />
                        <h2>Modals</h2>
                    </div>
                    <Card>
                        <CardContent className="flex h-40 flex-col items-center justify-center pt-6">
                            <p className="mb-4 text-sm text-gray-500">Portals and focus locking verified via hooks.</p>
                            <Button onClick={() => setIsModalOpen(true)}>Open Demonstration Modal</Button>
                            <Modal
                                isOpen={isModalOpen}
                                onClose={() => setIsModalOpen(false)}
                                title="Privacy Settings"
                            >
                                <div className="space-y-4">
                                    <p className="text-sm text-gray-500 dark:text-zinc-400">
                                        Are you sure you want to update your privacy settings? This will affect how your data is displayed to others.
                                    </p>
                                    <div className="flex justify-end gap-3 pt-4">
                                        <Button variant="outline" onClick={() => setIsModalOpen(false)}>
                                            Cancel
                                        </Button>
                                        <Button onClick={() => setIsModalOpen(false)}>
                                            Confirm Changes
                                        </Button>
                                    </div>
                                </div>
                            </Modal>
                        </CardContent>
                    </Card>
                </section>
            </div>
        </div>
    );
}
