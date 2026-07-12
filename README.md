# Ghost Editor

## Description

This project is an editor for creative coding based on Microsoft's Monaco Editor. Its mainly designed for the [p5.js](https://p5js.org) creative coding library for JavaScript and supports a novel versioning approach, as well as a real-time preview with error feedback. ChatGPT is used to provide helpful insights on both, versions and errors as well.


## Setup

This project is built using Electron and NodeJS and uses Electron Forge for its build process. As such, it supports hot-reloading for the frontend (Electron renderer), and can easily be built for different platforms. Prisma is used as an ORM for SQLite for the database, which is deployed and migrated locally during the first execution of the program. Setup requires the following steps:

1. Install NodeJS and `npm`.
2. Clone the repository to your system and open it in Visual Studio Code (the latter is a recommendation, but it helps if you want to work with Prisma, as there are helpful plugins).
3. Run `npm install` in the repository.
4. Create a `.env` file at the project root following this template:

```
DATABASE_FILENAME="database_filename.db"
DATABASE_URL="file:database_filename.db"

# NOTE: Currently, some functionality will just break when no or a invalid key is provided.
# This is a known bug and should be fixed in the future.
OPENAI_API_KEY="your_openai_api_key"
```

5. Run `npm start` to start the development server. This will launch a instance of the editor in development mode, with hot-reload for the frontend.
6. Run `npm run make` to build an installer/executable for your platform. Note: This is only tested on Windows so far!


## Usage

This editor is based on Microsoft's Monaco Editor and provides a real-time preview for P5JS. You can just use the library functions of P5JS, and thre preview will pick it up. From there, it is a pretty straigh-forward editing experience.

The party trick of this editor can be invoked by highlighting any segment of code, and then using a right-click to open the context menu. There, you can use add a Ghost Snapshot. This snapshot then allows you to scrub through every version you ever created for this code block.

The green plus button on the snapshot menu will save the current version in the version menu. You can open this menu by clicking into the code block, and then using the right-click context menu again. Clicking on a version in this menu will open a secondary version editor.

Finally, you can use the shortcuts listed in the context menu to access these features more efficiently.


## Notes

- Manually downgraded css-loader@5.2.7 for webpack to make the . See https://github.com/microsoft/monaco-editor/issues/2930.
- The build setup with Electron Forge is based on the webpack-typescript template, but was heavily altered to allow for both, a working development and production build including the database functionality. So keep that in mind when exploring the project. Not all of that might be the overall best solution, but it works. Hints for some choices can be found throughout the code.
- The `docker-compose.yaml` file is currently not needed anymore. It was used for a server-based database approach, and might make a comeback in the future.


## Things to Fix:

This is my recommended to do list for future work on this:

- Rebuild UI to be React-only, instead of the current patch-work system.
- Easy way to add new previews for different languages (right now, the process is very manual).
- Graceful error handling that won't immediately crash or break things, especially for the OpenAI component, and general backend errors.
- Handle files in a way that is more transparent to the user, so that they can rename files without losing progress, delete files without leaving data in the database, etc.
- Use tRPC to communicate between front- and backend to allow for easy migration to server-client architecture instead of Electron.
- Find a way to securely deliver API keys to the built application.
- Remove in-editor UI and migrate to VS Code plugin (this will require several of the other fixes described above).
- Re-iterate build system to fix Prisma integration, which is a nightmare right now.
- Merge changes into meaningful chunks for easier change navigation (e.g., sequential single line edits, multi-line operations as one operation).
- Add visual clues for blocks that disappear at a certain time in their timeline, because they had no exising lines at that time.
- Automatic version extraction from block histories.
- Version comparison using OpenAI's GPT.
- Optimize backend to write to cache, and update database asynchronously (reading works already).
- Blocks stick to semantics (e.g., brackets of functions, etc.)
